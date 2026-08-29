import { delay, http, HttpResponse } from 'msw';
import { z } from 'zod';
import {
  CitySnapshotSchema,
  METRIC_LABELS,
  MetricNameSchema,
  MetricVoteSchema,
  PROPOSAL_STATUSES,
  PlacedBlockInputSchema,
  ProposalInputSchema,
  SimulationResultInputSchema,
  type City,
  type MetricName,
  type PlacedBlock,
  type ProposalStatus,
} from '@rmc/shared';
import { API_BASE_URL } from '@/lib/env';
import {
  BLOCK_TYPES,
  COUNCIL_CITY_GRID_HEIGHT,
  COUNCIL_CITY_GRID_WIDTH,
  PERSONAS,
} from './fixtures';
import { claimsFromRequest, signMockToken } from './jwt';
import {
  blockCost,
  computeResults,
  createCity,
  createUser,
  db,
  findCity,
  findCouncilCity,
  findProposal,
  findUserByEmail,
  findUserById,
  myVotes,
  nextId,
  outcomeFor,
  persist,
  publicUser,
  replaceBallot,
  serialiseProposal,
  touchCity,
  validateLayout,
  type ProposalRecord,
} from './db';

/**
 * The mock backend.
 *
 * It implements all four specs closely enough that swapping VITE_API_MODE to `real`
 * should be a no-op for the UI - including the error codes the frontend branches on
 * (BUDGET_EXCEEDED, CELL_OCCUPIED, PROPOSAL_CLOSED, ...).
 */

const url = (path: string) => `${API_BASE_URL}${path}`;

const MoveBlockInputSchema = PlacedBlockInputSchema.pick({ x: true, y: true });
const CreateCityInputSchema = z.object({ name: z.string().max(60).optional() }).nullish();
const RenameCityInputSchema = z.object({ name: z.string().max(60) });
const AdvisorAnalysisInputSchema = z.object({
  city: CitySnapshotSchema,
  simulation: SimulationResultInputSchema,
  focus: MetricNameSchema.nullable().optional(),
});
const AdvisorProposalInputSchema = z.object({
  proposalId: z.string().min(1),
  votingResults: z.record(z.string(), z.unknown()).nullable().optional(),
});

/** Enough latency to make loading states visible, not enough to be annoying. */
const LATENCY = { fast: 90, normal: 220, llm: 1800 };

function layoutProblemStatus(problem: { code: string; details?: Record<string, unknown> }): number {
  if (problem.code === 'BLOCK_TYPE_INVALID') return 400;
  const x = problem.details?.x;
  const y = problem.details?.y;
  if (
    problem.code === 'OUT_OF_BOUNDS' &&
    ((typeof x === 'number' && x < 0) || (typeof y === 'number' && y < 0))
  ) {
    return 400;
  }
  return 409;
}

function validationError(message = 'The request body is invalid.') {
  return errorResponse(400, 'VALIDATION_FAILED', message);
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return HttpResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status },
  );
}

const UNAUTHORIZED = () =>
  errorResponse(401, 'UNAUTHORIZED', 'Your session has expired. Please sign in again.');

const CITY_NOT_FOUND = () => errorResponse(404, 'NOT_FOUND', 'That city does not exist.');

/** Returns the authenticated user id, or null when the caller must be rejected. */
function requireUserId(request: Request): string | null {
  const claims = claimsFromRequest(request);
  if (!claims || !findUserById(claims.sub)) return null;
  return claims.sub;
}

/** Public proposal reads tolerate a missing or expired token like the real backend. */
function optionalUserId(request: Request): string | null {
  const claims = claimsFromRequest(request);
  return claims && findUserById(claims.sub) ? claims.sub : null;
}

function requireAdmin(request: Request): Response | null {
  const claims = claimsFromRequest(request);
  if (!claims || !findUserById(claims.sub)) return UNAUTHORIZED();
  if (claims.role !== 'admin') {
    return errorResponse(403, 'FORBIDDEN', 'Requires role admin.');
  }
  return null;
}

export const handlers = [
  /* ------------------------------------------------------------------ auth */

  http.post(url('/auth/register'), async ({ request }) => {
    await delay(LATENCY.normal);
    const body = z
      .object({ email: z.email(), password: z.string().min(8), displayName: z.string().min(1).max(40) })
      .safeParse(await request.json().catch(() => null));
    if (!body.success) return validationError('Email, password and display name are invalid.');

    if (findUserByEmail(body.data.email)) {
      return errorResponse(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
    }

    const user = createUser(body.data.email, body.data.password, body.data.displayName);
    return HttpResponse.json(
      { token: signMockToken(user.id, user.email), user: publicUser(user) },
      { status: 201 },
    );
  }),

  http.post(url('/auth/login'), async ({ request }) => {
    await delay(LATENCY.normal);
    const body = z
      .object({ email: z.email(), password: z.string().min(1) })
      .safeParse(await request.json().catch(() => null));
    if (!body.success) return validationError('Email and password are required.');
    const user = findUserByEmail(body.data.email);

    // Same error for unknown email and wrong password - do not leak which.
    if (!user || user.password !== body.data.password) {
      return errorResponse(401, 'INVALID_CREDENTIALS', 'That email or password is not right.');
    }

    return HttpResponse.json({
      token: signMockToken(user.id, user.email),
      user: publicUser(user),
    });
  }),

  http.get(url('/auth/me'), async ({ request }) => {
    await delay(LATENCY.fast);
    const userId = requireUserId(request);
    const user = userId ? findUserById(userId) : undefined;
    if (!user) return UNAUTHORIZED();
    return HttpResponse.json(publicUser(user));
  }),

  /* --------------------------------------------------------------- catalog */

  http.get(url('/catalog/block-types'), async () => {
    await delay(LATENCY.fast);
    return HttpResponse.json(BLOCK_TYPES);
  }),

  http.get(url('/catalog/personas'), async () => {
    await delay(LATENCY.fast);
    return HttpResponse.json(PERSONAS);
  }),

  /* ---------------------------------------------------------------- cities */

  http.get(url('/cities'), async ({ request }) => {
    await delay(LATENCY.fast);
    const userId = requireUserId(request);
    if (!userId) return UNAUTHORIZED();

    const summaries = db.cities
      .filter((city) => city.ownerId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ id, name, blocksUsed, blockBudget, updatedAt }) => ({
        id,
        name,
        blocksUsed,
        blockBudget,
        updatedAt,
      }));

    return HttpResponse.json(summaries);
  }),

  http.post(url('/cities'), async ({ request }) => {
    await delay(LATENCY.normal);
    const userId = requireUserId(request);
    if (!userId) return UNAUTHORIZED();

    const body = CreateCityInputSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return validationError('A city name must be at most 60 characters.');
    const city = createCity(userId, body.data?.name?.trim() || 'My City');
    return HttpResponse.json(city, { status: 201 });
  }),

  // Registered ahead of the /:cityId wildcard below - MSW tries handlers in array
  // order, so the literal "council" segment must win before it is swallowed as a
  // (non-existent, owner-scoped) cityId.
  http.get(url('/cities/council'), async ({ request }) => {
    await delay(LATENCY.fast);
    if (!requireUserId(request)) return UNAUTHORIZED();

    const city = findCouncilCity();
    return city ? HttpResponse.json(city) : CITY_NOT_FOUND();
  }),

  http.get(url('/cities/:cityId'), async ({ request, params }) => {
    await delay(LATENCY.fast);
    const userId = requireUserId(request);
    if (!userId) return UNAUTHORIZED();

    const city = findCity(params.cityId as string, userId);
    return city ? HttpResponse.json(city) : CITY_NOT_FOUND();
  }),

  http.patch(url('/cities/:cityId'), async ({ request, params }) => {
    await delay(LATENCY.fast);
    const userId = requireUserId(request);
    if (!userId) return UNAUTHORIZED();

    const city = findCity(params.cityId as string, userId);
    if (!city) return CITY_NOT_FOUND();

    const body = RenameCityInputSchema.safeParse(await request.json().catch(() => null));
    if (!body.success || !body.data.name.trim()) {
      return validationError('A city needs a name of at most 60 characters.');
    }
    city.name = body.data.name.trim();
    return HttpResponse.json(touchCity(city));
  }),

  http.delete(url('/cities/:cityId'), async ({ request, params }) => {
    await delay(LATENCY.fast);
    const userId = requireUserId(request);
    if (!userId) return UNAUTHORIZED();

    const index = db.cities.findIndex(
      (city) => city.id === params.cityId && city.ownerId === userId,
    );
    if (index === -1) return CITY_NOT_FOUND();

    db.cities.splice(index, 1);
    persist();
    return new HttpResponse(null, { status: 204 });
  }),

  /* ---------------------------------------------------------------- blocks */

  /** Bulk replace - FE #1's autosave path. Nothing is saved if the layout is invalid. */
  http.put(url('/cities/:cityId/blocks'), async ({ request, params }) => {
    await delay(LATENCY.normal);
    const userId = requireUserId(request);
    if (!userId) return UNAUTHORIZED();

    const city = findCity(params.cityId as string, userId);
    if (!city) return CITY_NOT_FOUND();

    const raw = await request.json().catch(() => null);
    const incomingResult = z
      .object({ blocks: PlacedBlockInputSchema.array() })
      .safeParse(raw);
    if (!incomingResult.success) return validationError('The blocks layout is invalid.');
    const incoming = incomingResult.data.blocks;

    const problem = validateLayout(city, incoming);
    if (problem) {
      return errorResponse(layoutProblemStatus(problem), problem.code, problem.message, problem.details);
    }

    // Keep ids stable for cells that did not change, so animation references survive.
    const byCell = new Map(city.blocks.map((block) => [`${block.x},${block.y}`, block]));
    city.blocks = incoming.map((block) => {
      const existing = byCell.get(`${block.x},${block.y}`);
      return existing && existing.typeId === block.typeId
        ? existing
        : ({ ...block, id: nextId('blk') } satisfies PlacedBlock);
    });

    return HttpResponse.json(touchCity(city));
  }),

  http.post(url('/cities/:cityId/blocks'), async ({ request, params }) => {
    await delay(LATENCY.fast);
    const userId = requireUserId(request);
    if (!userId) return UNAUTHORIZED();

    const city = findCity(params.cityId as string, userId);
    if (!city) return CITY_NOT_FOUND();

    const inputResult = PlacedBlockInputSchema.safeParse(await request.json().catch(() => null));
    if (!inputResult.success) return validationError('The block placement is invalid.');
    const input = inputResult.data;
    const problem = validateLayout(city, [...city.blocks, input]);
    if (problem) {
      return errorResponse(layoutProblemStatus(problem), problem.code, problem.message, problem.details);
    }

    const block: PlacedBlock = { ...input, id: nextId('blk') };
    city.blocks.push(block);
    touchCity(city);

    return HttpResponse.json(
      { block, blocksUsed: city.blocksUsed, blockBudget: city.blockBudget },
      { status: 201 },
    );
  }),

  http.patch(url('/cities/:cityId/blocks/:blockId'), async ({ request, params }) => {
    await delay(LATENCY.fast);
    const userId = requireUserId(request);
    if (!userId) return UNAUTHORIZED();

    const city = findCity(params.cityId as string, userId);
    if (!city) return CITY_NOT_FOUND();

    const block = city.blocks.find((candidate) => candidate.id === params.blockId);
    if (!block) return errorResponse(404, 'NOT_FOUND', 'That block is not on the grid.');

    const moveResult = MoveBlockInputSchema.safeParse(await request.json().catch(() => null));
    if (!moveResult.success) return validationError('The block destination is invalid.');
    const { x, y } = moveResult.data;
    const proposed = city.blocks.map((candidate) =>
      candidate.id === block.id ? { ...candidate, x, y } : candidate,
    );

    const problem = validateLayout(city, proposed);
    if (problem) {
      return errorResponse(layoutProblemStatus(problem), problem.code, problem.message, problem.details);
    }

    block.x = x;
    block.y = y;
    touchCity(city);

    return HttpResponse.json({
      block,
      blocksUsed: city.blocksUsed,
      blockBudget: city.blockBudget,
    });
  }),

  http.delete(url('/cities/:cityId/blocks/:blockId'), async ({ request, params }) => {
    await delay(LATENCY.fast);
    const userId = requireUserId(request);
    if (!userId) return UNAUTHORIZED();

    const city = findCity(params.cityId as string, userId);
    if (!city) return CITY_NOT_FOUND();

    const index = city.blocks.findIndex((block) => block.id === params.blockId);
    if (index === -1) return errorResponse(404, 'NOT_FOUND', 'That block is not on the grid.');

    const [removed] = city.blocks.splice(index, 1);
    touchCity(city);

    return HttpResponse.json({
      block: removed,
      blocksUsed: city.blocksUsed,
      blockBudget: city.blockBudget,
    });
  }),

  /* ------------------------------------------------------------ simulation */

  http.put(url('/cities/:cityId/simulation'), async ({ request, params }) => {
    await delay(LATENCY.fast);
    const userId = requireUserId(request);
    if (!userId) return UNAUTHORIZED();

    const city = findCity(params.cityId as string, userId);
    if (!city) return CITY_NOT_FOUND();

    const result = SimulationResultInputSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!result.success) return validationError('That is not a valid simulation result.');

    const stored = { ...result.data, runAt: new Date().toISOString() };
    city.lastSimulation = stored;
    touchCity(city);

    return HttpResponse.json(stored);
  }),

  http.get(url('/cities/:cityId/simulation'), async ({ request, params }) => {
    await delay(LATENCY.fast);
    const userId = requireUserId(request);
    if (!userId) return UNAUTHORIZED();

    const city = findCity(params.cityId as string, userId);
    if (!city) return CITY_NOT_FOUND();
    if (!city.lastSimulation) {
      return errorResponse(404, 'NOT_FOUND', 'This city has not been simulated yet.');
    }

    return HttpResponse.json(city.lastSimulation);
  }),

  /* ------------------------------------------------------------- proposals */

  http.get(url('/proposals'), async ({ request }) => {
    await delay(LATENCY.fast);

    const requestedStatus = new URL(request.url).searchParams.get('status');
    if (requestedStatus && !PROPOSAL_STATUSES.includes(requestedStatus as ProposalStatus)) {
      return validationError('That proposal status is invalid.');
    }
    const status = requestedStatus as ProposalStatus | null;
    const proposals = db.proposals
      .filter((proposal) => !status || proposal.status === status)
      .map(serialiseProposal);

    return HttpResponse.json(proposals);
  }),

  /**
   * Authoring. First-class in Proposal mode, not just a seed hook - a citizen raises an
   * issue and expresses the fix as a block delta. `blockCost` is recomputed from
   * `changes` rather than trusted, exactly as BE #2 is asked to do.
   */
  http.post(url('/proposals'), async ({ request }) => {
    await delay(LATENCY.normal);
    if (!requireUserId(request)) return UNAUTHORIZED();

    const bodyResult = ProposalInputSchema.safeParse(await request.json().catch(() => null));
    if (!bodyResult.success) return validationError('The proposal body is invalid.');
    const body = bodyResult.data;
    if (!body.title.trim() || !body.description.trim()) {
      return validationError('A title and a description are required.');
    }

    if (
      body.location &&
      (body.location.x >= COUNCIL_CITY_GRID_WIDTH || body.location.y >= COUNCIL_CITY_GRID_HEIGHT)
    ) {
      return errorResponse(
        400,
        'OUT_OF_BOUNDS',
        `Cell (${body.location.x}, ${body.location.y}) is outside the ${COUNCIL_CITY_GRID_WIDTH}×${COUNCIL_CITY_GRID_HEIGHT} grid.`,
      );
    }
    if (
      body.location &&
      db.proposals.some(
        (proposal) =>
          proposal.status === 'open' &&
          proposal.location?.x === body.location?.x &&
          proposal.location?.y === body.location?.y,
      )
    ) {
      return errorResponse(
        409,
        'PROPOSAL_EXISTS_AT_CELL',
        `An open proposal already exists at cell (${body.location.x}, ${body.location.y}).`,
      );
    }

    for (const change of body.changes ?? []) {
      if (change.x >= COUNCIL_CITY_GRID_WIDTH || change.y >= COUNCIL_CITY_GRID_HEIGHT) {
        return errorResponse(
          400,
          'OUT_OF_BOUNDS',
          `Cell (${change.x}, ${change.y}) is outside the ${COUNCIL_CITY_GRID_WIDTH}×${COUNCIL_CITY_GRID_HEIGHT} grid.`,
        );
      }
      if (change.op === 'place' && !change.typeId) {
        return errorResponse(400, 'BLOCK_TYPE_REQUIRED', 'typeId is required for a place change.');
      }
      if (change.op === 'place' && !BLOCK_TYPES.some((type) => type.id === change.typeId)) {
        return errorResponse(
          400,
          'BLOCK_TYPE_INVALID',
          `Unknown block type: "${change.typeId}".`,
        );
      }
      if (change.op !== 'place' && !change.blockId) {
        return errorResponse(
          400,
          'BLOCK_ID_REQUIRED',
          `blockId is required for a ${change.op} change.`,
        );
      }
    }

    const changes = body.changes ?? [];
    const proposal: ProposalRecord = {
      ...body,
      id: nextId('prp'),
      changes,
      blockCost: changes.reduce(
        (sum, change) =>
          change.op === 'place' && change.typeId ? sum + blockCost(change.typeId) : sum,
        0,
      ),
      expectedBenefits: body.expectedBenefits ?? [],
      affectedPersonaIds: body.affectedPersonaIds ?? [],
      status: 'open',
      createdAt: new Date().toISOString(),
    };

    db.proposals.unshift(proposal);
    persist();

    return HttpResponse.json(serialiseProposal(proposal), { status: 201 });
  }),

  http.get(url('/proposals/:proposalId'), async ({ request, params }) => {
    await delay(LATENCY.fast);
    const userId = optionalUserId(request);

    const proposal = findProposal(params.proposalId as string);
    if (!proposal) return errorResponse(404, 'NOT_FOUND', 'That proposal does not exist.');

    return HttpResponse.json({
      ...serialiseProposal(proposal),
      myVotes: userId ? myVotes(proposal.id, userId) : null,
    });
  }),

  http.put(url('/proposals/:proposalId/votes'), async ({ request, params }) => {
    await delay(LATENCY.normal);
    const userId = requireUserId(request);
    if (!userId) return UNAUTHORIZED();

    const proposal = findProposal(params.proposalId as string);
    if (!proposal) return errorResponse(404, 'NOT_FOUND', 'That proposal does not exist.');
    if (proposal.status !== 'open') {
      return errorResponse(409, 'PROPOSAL_CLOSED', 'Voting has closed for this proposal.');
    }

    const body = z
      .object({ votes: MetricVoteSchema.array().min(1) })
      .safeParse(await request.json().catch(() => null));
    if (!body.success) return validationError('Your ballot is invalid.');
    const votes = body.data.votes;
    const submitted = votes.map((vote) => vote.metric);

    // Partial ballots are rejected so aggregation stays comparable across metrics.
    const missing = proposal.votingMetrics.filter((metric) => !submitted.includes(metric));
    const unknown = submitted.filter(
      (metric) => !proposal.votingMetrics.includes(metric as MetricName),
    );
    const duplicated = submitted.length !== new Set(submitted).size;

    if (missing.length || unknown.length || duplicated) {
      return errorResponse(
        400,
        'INVALID_BALLOT',
        'Your ballot must cover exactly the metrics this proposal is voted on.',
        { missing, unknown, duplicated },
      );
    }

    replaceBallot(proposal.id, userId, votes);

    return HttpResponse.json({
      myVotes: myVotes(proposal.id, userId) ?? [],
      results: computeResults(proposal),
    });
  }),

  http.get(url('/proposals/:proposalId/results'), async ({ request, params }) => {
    await delay(LATENCY.fast);
    if (!requireUserId(request)) return UNAUTHORIZED();

    const proposal = findProposal(params.proposalId as string);
    if (!proposal) return errorResponse(404, 'NOT_FOUND', 'That proposal does not exist.');

    return HttpResponse.json(computeResults(proposal));
  }),

  http.post(url('/proposals/:proposalId/close'), async ({ request, params }) => {
    await delay(LATENCY.normal);
    const adminError = requireAdmin(request);
    if (adminError) return adminError;

    const proposal = findProposal(params.proposalId as string);
    if (!proposal) return errorResponse(404, 'NOT_FOUND', 'That proposal does not exist.');
    if (proposal.status !== 'open') {
      return errorResponse(409, 'PROPOSAL_CLOSED', 'This proposal is already closed.');
    }

    const results = computeResults(proposal);
    proposal.status = outcomeFor(results.overallApprovalPct);
    persist();

    return HttpResponse.json(serialiseProposal(proposal));
  }),

  /* --------------------------------------------------------------- advisor */

  /**
   * Stands in for BE #2's LLM call. It follows the same rules the real prompt has to:
   * describe what the data shows, never predict a vote, never change game state.
   * Always flagged `fallback: true` so the UI shows its "canned advice" treatment.
   */
  http.post(url('/advisor/analysis'), async ({ request }) => {
    await delay(LATENCY.llm);
    if (!requireUserId(request)) return UNAUTHORIZED();

    const bodyResult = AdvisorAnalysisInputSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!bodyResult.success) return validationError('The Advisor analysis payload is invalid.');
    const body = bodyResult.data;

    const metrics = Object.entries(body.simulation.metrics) as Array<[MetricName, number]>;
    const [weakestMetric, weakestScore] = metrics.reduce((worst, entry) =>
      entry[1] < worst[1] ? entry : worst,
    );

    const failed = body.simulation.journeys.filter((journey) => !journey.accessible);
    const worst = [...body.simulation.journeys].sort(
      (a, b) => b.travelTimeMinutes - a.travelTimeMinutes,
    )[0];

    const missingTypes = BLOCK_TYPES.filter(
      (type) => !body.city.blocks.some((block) => block.typeId === type.id),
    );

    return HttpResponse.json({
      headline: failed.length
        ? `${failed.length} of ${body.simulation.journeys.length} resident journeys fail today.`
        : 'Every tested journey succeeds, but the margins are thin in the north.',
      biggestWeakness: {
        metric: weakestMetric,
        explanation: `${METRIC_LABELS[weakestMetric]} scores ${Math.round(weakestScore)}. ${
          worst
            ? `The longest journey tested takes ${Math.round(worst.travelTimeMinutes)} minutes to reach ${worst.targetService.replace(/_/g, ' ')}.`
            : 'No journeys were recorded in this run.'
        }`,
      },
      affectedGroups: failed.slice(0, 3).map((journey) => ({
        personaId: journey.personaId,
        impact:
          journey.issues[0] ??
          `Cannot reach ${journey.targetService.replace(/_/g, ' ')} within a comfortable journey time.`,
      })),
      tradeoffs: [
        `You have used ${body.city.blocksUsed} of ${body.city.blockBudget} blocks - adding transport costs ${blockCost('transport')} per block.`,
        'Central placement shortens journeys but takes space away from housing.',
      ],
      suggestions: [
        {
          title: 'Bridge the gap between the housing cluster and healthcare',
          description:
            'A run of transport blocks down the middle of the grid would connect the northern homes to the services in the south without moving either.',
          expectedImpact: ['accessibility', 'inclusion'],
        },
        ...(missingTypes.length
          ? [
              {
                title: `Your city has no ${missingTypes[0]?.name.toLowerCase()} yet`,
                description: missingTypes[0]?.description ?? '',
                expectedImpact: ['community'] as MetricName[],
              },
            ]
          : []),
      ],
      fallback: true,
    });
  }),

  http.post(url('/advisor/proposal-explanation'), async ({ request }) => {
    await delay(LATENCY.llm);
    if (!requireUserId(request)) return UNAUTHORIZED();

    const bodyResult = AdvisorProposalInputSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!bodyResult.success) return validationError('The Advisor proposal payload is invalid.');
    const body = bodyResult.data;

    const proposal = findProposal(body.proposalId);
    if (!proposal) return errorResponse(404, 'NOT_FOUND', 'That proposal does not exist.');

    const votingResults = body.votingResults as {
      metricResults?: Array<{ metric: MetricName; supportPct: number }>;
    } | null | undefined;
    const ranked = [...(votingResults?.metricResults ?? [])].sort(
      (a, b) => b.supportPct - a.supportPct,
    );
    const strongest = ranked[0];
    const weakest = ranked[ranked.length - 1];

    return HttpResponse.json({
      explanation: `${proposal.title} would use ${proposal.blockCost} of the city's blocks${
        proposal.location ? ` at cell (${proposal.location.x}, ${proposal.location.y})` : ''
      }. ${proposal.description}`,
      tradeoffs: [
        `Spending ${proposal.blockCost} blocks here leaves less budget for other services.`,
        ...(proposal.affectedPersonaIds.length
          ? [
              `Residents most affected: ${proposal.affectedPersonaIds
                .map((id) => PERSONAS.find((persona) => persona.id === id)?.name ?? id)
                .join(', ')}.`,
            ]
          : []),
      ],
      communityReadout:
        strongest && weakest && strongest !== weakest
          ? `Support is strongest on ${METRIC_LABELS[strongest.metric].toLowerCase()} (${strongest.supportPct}%) and weakest on ${METRIC_LABELS[weakest.metric].toLowerCase()} (${weakest.supportPct}%).`
          : null,
      fallback: true,
    });
  }),

  http.post(url('/advisor/newspaper'), async ({ request }) => {
    await delay(LATENCY.llm);
    if (!requireUserId(request)) return UNAUTHORIZED();

    const bodyResult = AdvisorProposalInputSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!bodyResult.success) return validationError('The Advisor proposal payload is invalid.');
    const body = bodyResult.data;
    const proposal = findProposal(body.proposalId);
    if (!proposal) return errorResponse(404, 'NOT_FOUND', 'That proposal does not exist.');

    const results = computeResults(proposal);
    return HttpResponse.json({
      headline: `${proposal.title}: residents make their voices heard`,
      summary: `${proposal.description} The community has now recorded its response to the proposal.`,
      voteResult: `${results.overallApprovalPct}% of citizens support the proposal.`,
      otherHeadlines: [
        "Residents discuss city's future direction",
        'Community engagement reaches new heights',
        'City planners respond to citizen feedback',
      ],
      fallback: true,
    });
  }),

  http.post(url('/advisor/citizen-perspectives'), async ({ request }) => {
    await delay(LATENCY.llm);
    if (!requireUserId(request)) return UNAUTHORIZED();

    const bodyResult = AdvisorProposalInputSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!bodyResult.success) return validationError('The Advisor proposal payload is invalid.');
    const body = bodyResult.data;
    const proposal = findProposal(body.proposalId);
    if (!proposal) return errorResponse(404, 'NOT_FOUND', 'That proposal does not exist.');

    return HttpResponse.json({
      perspectives: [
        {
          persona: 'Older residents',
          emoji: '👵',
          quote: 'We need changes that keep essential services easy to reach.',
        },
        {
          persona: 'Families',
          emoji: '👨‍👩‍👧',
          quote: 'We are weighing how this affects our children’s daily routine.',
        },
        {
          persona: 'Remote workers',
          emoji: '🧑‍💻',
          quote: 'We want to understand how this changes the way our neighbourhood works.',
        },
        {
          persona: 'Students',
          emoji: '🎓',
          quote: 'We want this proposal to fit into a fairer, more connected city.',
        },
      ],
      advisorSummary: `Residents are considering the balanced effects of ${proposal.title} on daily life.`,
      fallback: true,
    });
  }),
];

/** Handy in the console during the demo. */
export function exposeMockCity(): City | undefined {
  return db.cities[0];
}
