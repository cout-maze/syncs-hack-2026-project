import { delay, http, HttpResponse } from 'msw';
import {
  METRIC_LABELS,
  type City,
  type MetricName,
  type MetricVote,
  type PlacedBlock,
  type PlacedBlockInput,
  type ProposalInput,
  type ProposalStatus,
  type SimulationResultInput,
} from '@rmc/shared';
import { API_BASE_URL } from '@/lib/env';
import { BLOCK_TYPES, PERSONAS } from './fixtures';
import { claimsFromRequest, signMockToken } from './jwt';
import {
  blockCost,
  computeResults,
  createCity,
  createUser,
  db,
  findCity,
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

/** Enough latency to make loading states visible, not enough to be annoying. */
const LATENCY = { fast: 90, normal: 220, llm: 1800 };

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

export const handlers = [
  /* ------------------------------------------------------------------ auth */

  http.post(url('/auth/register'), async ({ request }) => {
    await delay(LATENCY.normal);
    const body = (await request.json()) as {
      email?: string;
      password?: string;
      displayName?: string;
    };

    if (!body.email || !body.password || !body.displayName) {
      return errorResponse(400, 'VALIDATION_FAILED', 'Email, password and display name are required.');
    }
    if (body.password.length < 8) {
      return errorResponse(400, 'VALIDATION_FAILED', 'Password must be at least 8 characters.');
    }
    if (findUserByEmail(body.email)) {
      return errorResponse(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
    }

    const user = createUser(body.email, body.password, body.displayName);
    return HttpResponse.json(
      { token: signMockToken(user.id, user.email), user: publicUser(user) },
      { status: 201 },
    );
  }),

  http.post(url('/auth/login'), async ({ request }) => {
    await delay(LATENCY.normal);
    const body = (await request.json()) as { email?: string; password?: string };
    const user = body.email ? findUserByEmail(body.email) : undefined;

    // Same error for unknown email and wrong password - do not leak which.
    if (!user || user.password !== body.password) {
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

    const body = (await request.json().catch(() => ({}))) as { name?: string };
    const city = createCity(userId, body.name?.trim() || 'My City');
    return HttpResponse.json(city, { status: 201 });
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

    const body = (await request.json()) as { name?: string };
    if (!body.name?.trim()) {
      return errorResponse(400, 'VALIDATION_FAILED', 'A city needs a name.');
    }
    city.name = body.name.trim().slice(0, 60);
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

    const body = (await request.json()) as { blocks?: PlacedBlockInput[] };
    const incoming = body.blocks ?? [];

    const problem = validateLayout(city, incoming);
    if (problem) return errorResponse(409, problem.code, problem.message, problem.details);

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

    const input = (await request.json()) as PlacedBlockInput;
    const problem = validateLayout(city, [...city.blocks, input]);
    if (problem) return errorResponse(409, problem.code, problem.message, problem.details);

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

    const { x, y } = (await request.json()) as { x: number; y: number };
    const proposed = city.blocks.map((candidate) =>
      candidate.id === block.id ? { ...candidate, x, y } : candidate,
    );

    const problem = validateLayout(city, proposed);
    if (problem) return errorResponse(409, problem.code, problem.message, problem.details);

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

    const result = (await request.json()) as SimulationResultInput;
    if (!result?.metrics || !Array.isArray(result.journeys) || !Array.isArray(result.events)) {
      return errorResponse(400, 'VALIDATION_FAILED', 'That is not a valid simulation result.');
    }

    const stored = { ...result, runAt: new Date().toISOString() };
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

    const status = new URL(request.url).searchParams.get('status') as ProposalStatus | null;
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

    const body = (await request.json()) as ProposalInput;

    if (!body?.title?.trim() || !body?.description?.trim()) {
      return errorResponse(400, 'VALIDATION_FAILED', 'A title and a description are required.');
    }
    if (!body.votingMetrics?.length) {
      return errorResponse(
        400,
        'VALIDATION_FAILED',
        'Pick at least one quality for people to rate.',
      );
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

    const body = (await request.json()) as { votes?: MetricVote[] };
    const votes = body.votes ?? [];
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
    if (!requireUserId(request)) return UNAUTHORIZED();

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

    const body = (await request.json()) as {
      city: { blocks: Array<{ typeId: string }>; blocksUsed: number; blockBudget: number };
      simulation: SimulationResultInput;
    };

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

    const body = (await request.json()) as {
      proposalId: string;
      votingResults?: { metricResults: Array<{ metric: MetricName; supportPct: number }> } | null;
    };

    const proposal = findProposal(body.proposalId);
    if (!proposal) return errorResponse(404, 'NOT_FOUND', 'That proposal does not exist.');

    const ranked = [...(body.votingResults?.metricResults ?? [])].sort(
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
];

/** Handy in the console during the demo. */
export function exposeMockCity(): City | undefined {
  return db.cities[0];
}
