import {
  DEFAULT_BLOCK_BUDGET,
  DEFAULT_GRID_HEIGHT,
  DEFAULT_GRID_WIDTH,
  OUTCOME_THRESHOLDS,
  type City,
  type MetricName,
  type MetricVote,
  type PlacedBlock,
  type PlacedBlockInput,
  type ProposalInput,
  type ProposalStatus,
  type VotingResults,
} from '@rmc/shared';
import {
  BLOCK_TYPES,
  COUNCIL_CITY_BLOCK_BUDGET,
  COUNCIL_CITY_BLOCKS,
  COUNCIL_CITY_GRID_HEIGHT,
  COUNCIL_CITY_GRID_WIDTH,
  DEMO_ACCOUNT,
  DEMO_CITY_BLOCKS,
  SEED_PROPOSALS,
} from './fixtures';

/**
 * In-memory database for the mock backend, mirrored to localStorage.
 *
 * Persisting matters: FE #1's acceptance criterion is "drag five blocks on, reload the
 * page, the city is still there". A stateless mock cannot prove that, so this one keeps
 * state until you call resetMockDb().
 */

/**
 * Bump the version suffix whenever the shape of seeded data changes (grid size, demo
 * city, seed proposals, ...). Without this, a browser holding old data can silently keep
 * loading an outdated city forever - `load()` only seeds fresh when the key is absent, so
 * fresh when the key is entirely absent, so a stale key looks identical to real user
 * work and never gets touched. Bumping the key makes old data simply not match, so it
 * reseeds automatically instead of requiring `__rmcResetMocks()` by hand.
 */
const STORAGE_KEY = 'rmc.mockdb.v4';

interface MockUser {
  id: string;
  email: string;
  /** Plain text - this is a browser mock, there is nothing to protect. */
  password: string;
  displayName: string;
  role: 'user' | 'admin';
  createdAt: string;
}

interface ProposalRecord extends ProposalInput {
  id: string;
  status: ProposalStatus;
  createdAt: string;
}

interface VoteRow {
  userId: string;
  proposalId: string;
  metric: MetricName;
  support: boolean;
}

interface MockDb {
  users: MockUser[];
  cities: City[];
  proposals: ProposalRecord[];
  votes: VoteRow[];
  seq: number;
}

/* ------------------------------------------------------------------ seeding */

function nowIso(): string {
  return new Date().toISOString();
}

export function blockCost(typeId: string): number {
  return BLOCK_TYPES.find((type) => type.id === typeId)?.cost ?? 1;
}

export function totalCost(blocks: Array<{ typeId: string }>): number {
  return blocks.reduce((sum, block) => sum + blockCost(block.typeId), 0);
}

function seed(): MockDb {
  const createdAt = nowIso();
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}_${(++seq).toString(36).padStart(4, '0')}`;

  const demoUser: MockUser = {
    id: 'usr_demo',
    email: DEMO_ACCOUNT.email,
    password: DEMO_ACCOUNT.password,
    displayName: DEMO_ACCOUNT.displayName,
    role: 'user',
    createdAt,
  };

  const demoBlocks: PlacedBlock[] = DEMO_CITY_BLOCKS.map((block) => ({
    ...block,
    id: nextId('blk'),
  }));

  const demoCity: City = {
    id: 'cty_demo',
    ownerId: demoUser.id,
    name: 'Riverside',
    gridWidth: DEFAULT_GRID_WIDTH,
    gridHeight: DEFAULT_GRID_HEIGHT,
    blockBudget: DEFAULT_BLOCK_BUDGET,
    blocksUsed: totalCost(demoBlocks),
    blocks: demoBlocks,
    lastSimulation: null,
    createdAt,
    updatedAt: createdAt,
  };

  /**
   * The council's city - fixed, shared, the same for every user. Proposal mode shows
   * this instead of the caller's own city; Simulation mode never touches it. It is not
   * owned by any real user (`ownerId: 'council'` never matches a JWT `sub`), so the
   * owner-scoped `/cities/{id}` CRUD can never return or mutate it - `getCouncilCity()`
   * is the only way to reach it.
   */
  const councilBlocks: PlacedBlock[] = COUNCIL_CITY_BLOCKS.map((block) => ({
    ...block,
    id: nextId('cblk'),
  }));

  const councilCity: City = {
    id: 'cty_council',
    ownerId: 'council',
    name: "The Council's City",
    gridWidth: COUNCIL_CITY_GRID_WIDTH,
    gridHeight: COUNCIL_CITY_GRID_HEIGHT,
    blockBudget: COUNCIL_CITY_BLOCK_BUDGET,
    blocksUsed: totalCost(councilBlocks),
    blocks: councilBlocks,
    lastSimulation: null,
    createdAt,
    updatedAt: createdAt,
  };

  const proposals: ProposalRecord[] = SEED_PROPOSALS.map((proposal) => ({
    id: proposal.id,
    title: proposal.title,
    issue: proposal.issue,
    description: proposal.description,
    location: proposal.location,
    changes: proposal.changes,
    blockCost: proposal.blockCost,
    expectedBenefits: proposal.expectedBenefits,
    affectedPersonaIds: proposal.affectedPersonaIds,
    votingMetrics: proposal.votingMetrics,
    status: 'open',
    createdAt,
  }));

  // Seed ballots become ordinary vote rows, exactly as BE #2 stores them.
  const votes: VoteRow[] = [];
  for (const proposal of SEED_PROPOSALS) {
    for (const metric of proposal.votingMetrics) {
      const split = proposal.seedVotes[metric];
      if (!split) continue;
      for (let index = 0; index < proposal.seedVoterCount; index += 1) {
        votes.push({
          userId: `usr_seed_${index + 1}`,
          proposalId: proposal.id,
          metric,
          support: index < split.support,
        });
      }
    }
  }

  return { users: [demoUser], cities: [demoCity, councilCity], proposals, votes, seq };
}

/* -------------------------------------------------------------- persistence */

function load(): MockDb {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as MockDb;
      let dirty = false;
      // Keep users who already have a saved Simulation city, but backfill the
      // council city when upgrading from the downloaded build that predated the
      // fixed proposal map.
      //
      // The council city is fixed and shared - no endpoint can edit it - so a saved
      // copy that differs from the fixture in ANY way is stale, not user work. The
      // block count and budget are checked alongside the grid size: editing the
      // layout without resizing the grid is the common case, and a size-only check
      // would leave an old map on screen for anyone who had already loaded the app.
      const savedCouncil = saved.cities.find((city) => city.id === 'cty_council');
      if (
        !savedCouncil ||
        savedCouncil.gridWidth !== COUNCIL_CITY_GRID_WIDTH ||
        savedCouncil.gridHeight !== COUNCIL_CITY_GRID_HEIGHT ||
        savedCouncil.blockBudget !== COUNCIL_CITY_BLOCK_BUDGET ||
        savedCouncil.blocks.length !== COUNCIL_CITY_BLOCKS.length
      ) {
        const council = seed().cities.find((city) => city.id === 'cty_council');
        if (council) {
          saved.cities = saved.cities.filter((city) => city.id !== 'cty_council');
          saved.cities.push(council);
          dirty = true;
        }
      }
      // Catalog costs are part of the persisted city's derived state. Recompute
      // them when the catalog changes so an existing browser session cannot show
      // a stale budget total after switching between mock and real modes.
      for (const city of saved.cities) {
        const recalculated = totalCost(city.blocks);
        if (city.blocksUsed !== recalculated) {
          city.blocksUsed = recalculated;
          dirty = true;
        }
      }
      if (dirty) save(saved);
      return saved;
    }
  } catch {
    /* fall through to a fresh seed */
  }
  const fresh = seed();
  save(fresh);
  return fresh;
}

function save(next: MockDb): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage full or unavailable - the in-memory copy still works */
  }
}

export const db: MockDb = load();

export function persist(): void {
  save(db);
}

/** Wipe mock state and reseed. Exposed on window as `__rmcResetMocks()`. */
export function resetMockDb(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  const fresh = seed();
  db.users = fresh.users;
  db.cities = fresh.cities;
  db.proposals = fresh.proposals;
  db.votes = fresh.votes;
  db.seq = fresh.seq;
  save(db);
}

export function nextId(prefix: string): string {
  db.seq += 1;
  return `${prefix}_${db.seq.toString(36).padStart(4, '0')}`;
}

/* ------------------------------------------------------------------ lookups */

export function findUserById(userId: string): MockUser | undefined {
  return db.users.find((user) => user.id === userId);
}

export function findUserByEmail(email: string): MockUser | undefined {
  const normalised = email.trim().toLowerCase();
  return db.users.find((user) => user.email.toLowerCase() === normalised);
}

export function createUser(email: string, password: string, displayName: string): MockUser {
  const user: MockUser = {
    id: nextId('usr'),
    email: email.trim(),
    password,
    displayName,
    role: 'user',
    createdAt: nowIso(),
  };
  db.users.push(user);
  persist();
  return user;
}

export function publicUser(user: MockUser) {
  const { id, email, displayName, role, createdAt } = user;
  return { id, email, displayName, role, createdAt };
}

/** Cities are owner-scoped: another user's city reads as 404, never 403. */
export function findCity(cityId: string, ownerId: string): City | undefined {
  return db.cities.find((city) => city.id === cityId && city.ownerId === ownerId);
}

/**
 * The one council city, unscoped by owner - every authenticated user reads the exact
 * same record. There is no create/update path for it; it only ever comes back from
 * `seed()`/`resetMockDb()`.
 */
export function findCouncilCity(): City | undefined {
  return db.cities.find((city) => city.id === 'cty_council');
}

export function createCity(ownerId: string, name = 'My City'): City {
  const createdAt = nowIso();
  const city: City = {
    id: nextId('cty'),
    ownerId,
    name,
    gridWidth: DEFAULT_GRID_WIDTH,
    gridHeight: DEFAULT_GRID_HEIGHT,
    blockBudget: DEFAULT_BLOCK_BUDGET,
    blocksUsed: 0,
    blocks: [],
    lastSimulation: null,
    createdAt,
    updatedAt: createdAt,
  };
  db.cities.unshift(city);
  persist();
  return city;
}

export function touchCity(city: City): City {
  city.blocksUsed = totalCost(city.blocks);
  city.updatedAt = nowIso();
  persist();
  return city;
}

/* --------------------------------------------------------- layout validation */

export type LayoutProblem = { code: string; message: string; details?: Record<string, unknown> };

/**
 * Server-side placement rules, same as BE #1 enforces: in bounds, one block per cell,
 * and the sum of costs within budget.
 */
export function validateLayout(city: City, blocks: PlacedBlockInput[]): LayoutProblem | null {
  const seen = new Set<string>();

  for (const block of blocks) {
    if (
      block.x < 0 ||
      block.y < 0 ||
      block.x >= city.gridWidth ||
      block.y >= city.gridHeight
    ) {
      return {
        code: 'OUT_OF_BOUNDS',
        message: `Cell (${block.x}, ${block.y}) is outside the ${city.gridWidth}x${city.gridHeight} grid.`,
        details: { x: block.x, y: block.y },
      };
    }

    const key = `${block.x},${block.y}`;
    if (seen.has(key)) {
      return {
        code: 'CELL_OCCUPIED',
        message: `Two blocks were placed on cell (${block.x}, ${block.y}).`,
        details: { x: block.x, y: block.y },
      };
    }
    seen.add(key);

    if (!BLOCK_TYPES.some((type) => type.id === block.typeId)) {
      return {
        // Keep the public error code aligned with the real city service.
        code: 'BLOCK_TYPE_INVALID',
        message: `"${block.typeId}" is not a block type in the catalog.`,
        details: { typeId: block.typeId },
      };
    }
  }

  const cost = totalCost(blocks);
  if (cost > city.blockBudget) {
    return {
      code: 'BUDGET_EXCEEDED',
      message: `This layout costs ${cost} blocks, over the ${city.blockBudget}-block budget.`,
      details: { cost, blockBudget: city.blockBudget },
    };
  }

  return null;
}

/* ------------------------------------------------------------- vote counting */

/**
 * Results derive only from vote rows - no AI, no overrides. This is the hard rule
 * from the proposal doc, and the mock honours it so the UI can never drift from it.
 */
export function computeResults(proposal: ProposalRecord): VotingResults {
  const rows = db.votes.filter((vote) => vote.proposalId === proposal.id);

  const metricResults = proposal.votingMetrics.map((metric) => {
    const forMetric = rows.filter((vote) => vote.metric === metric);
    const supportCount = forMetric.filter((vote) => vote.support).length;
    const opposeCount = forMetric.length - supportCount;
    const total = supportCount + opposeCount;
    const supportPct = total === 0 ? 0 : round1((supportCount / total) * 100);
    return { metric, supportCount, opposeCount, supportPct };
  });

  const overallApprovalPct =
    metricResults.length === 0
      ? 0
      : round1(
          metricResults.reduce((sum, result) => sum + result.supportPct, 0) / metricResults.length,
        );

  const totalVoters = new Set(rows.map((vote) => vote.userId)).size;

  return {
    totalVoters,
    metricResults,
    overallApprovalPct,
    outcomeIfClosedNow: outcomeFor(overallApprovalPct),
  };
}

export function outcomeFor(overallApprovalPct: number): 'approved' | 'rejected' | 'reconsider' {
  if (overallApprovalPct >= OUTCOME_THRESHOLDS.approved) return 'approved';
  if (overallApprovalPct < OUTCOME_THRESHOLDS.rejected) return 'rejected';
  return 'reconsider';
}

/** Replace a user's ballot wholesale - that is what makes re-voting idempotent. */
export function replaceBallot(proposalId: string, userId: string, votes: MetricVote[]): void {
  db.votes = db.votes.filter(
    (vote) => !(vote.proposalId === proposalId && vote.userId === userId),
  );
  for (const vote of votes) {
    db.votes.push({ userId, proposalId, metric: vote.metric, support: vote.support });
  }
  persist();
}

export function myVotes(proposalId: string, userId: string): MetricVote[] | null {
  const rows = db.votes.filter(
    (vote) => vote.proposalId === proposalId && vote.userId === userId,
  );
  if (rows.length === 0) return null;
  return rows.map((vote) => ({ metric: vote.metric, support: vote.support }));
}

export function findProposal(proposalId: string): ProposalRecord | undefined {
  return db.proposals.find((proposal) => proposal.id === proposalId);
}

export function serialiseProposal(proposal: ProposalRecord) {
  return { ...proposal, results: computeResults(proposal) };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export type { MockUser, ProposalRecord, VoteRow };
