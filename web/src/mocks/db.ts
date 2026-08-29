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
import { BLOCK_TYPES, DEMO_ACCOUNT, DEMO_CITY_BLOCKS, SEED_PROPOSALS } from './fixtures';

/**
 * In-memory database for the mock backend, mirrored to localStorage.
 *
 * Persisting matters: FE #1's acceptance criterion is "drag five blocks on, reload the
 * page, the city is still there". A stateless mock cannot prove that, so this one keeps
 * state until you call resetMockDb().
 */

/**
 * Bump the version suffix whenever the shape of seeded data changes (grid size, demo
 * city, seed proposals, ...). Without this, a browser holding v1 data from before the
 * 30x30 default silently keeps loading its old 10x10 city forever - `load()` only seeds
 * fresh when the key is entirely absent, so a stale key looks identical to real user
 * work and never gets touched. Bumping the key makes old data simply not match, so it
 * reseeds automatically instead of requiring `__rmcResetMocks()` by hand.
 */
const STORAGE_KEY = 'rmc.mockdb.v2';

interface MockUser {
  id: string;
  email: string;
  /** Plain text - this is a browser mock, there is nothing to protect. */
  password: string;
  displayName: string;
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

  return { users: [demoUser], cities: [demoCity], proposals, votes, seq };
}

/* -------------------------------------------------------------- persistence */

function load(): MockDb {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as MockDb;
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
    createdAt: nowIso(),
  };
  db.users.push(user);
  persist();
  return user;
}

export function publicUser(user: MockUser) {
  const { id, email, displayName, createdAt } = user;
  return { id, email, displayName, createdAt };
}

/** Cities are owner-scoped: another user's city reads as 404, never 403. */
export function findCity(cityId: string, ownerId: string): City | undefined {
  return db.cities.find((city) => city.id === cityId && city.ownerId === ownerId);
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
        code: 'UNKNOWN_BLOCK_TYPE',
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
