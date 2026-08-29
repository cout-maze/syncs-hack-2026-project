import {
  DEFAULT_BLOCK_BUDGET,
  DEFAULT_GRID_HEIGHT,
  DEFAULT_GRID_WIDTH,
  generateCity,
} from '@rmc/shared';
import type { BlockType, MetricName, Persona, PlacedBlockInput, ProposalInput } from '@rmc/shared';

/**
 * Seed data for the in-browser mock backend.
 *
 * These values mirror what BE #1 ships from its JSON seed files and what BE #2 seeds
 * for proposals. Keep them aligned with the real backend so the demo copy does not
 * change when we switch VITE_API_MODE to `real`.
 */

export const DEMO_ACCOUNT = {
  email: 'demo@city.dev',
  password: 'demo1234',
  displayName: 'Demo Planner',
} as const;

/* --------------------------------------------------------- block catalogue */

export const BLOCK_TYPES: BlockType[] = [
  {
    id: 'housing',
    name: 'Housing',
    category: 'people',
    cost: 2,
    description: 'Homes for residents — the starting point every journey is measured from.',
    benefits: ['Grows the population the rest of the city serves'],
    tradeoffs: ['Placed far from services, it creates long resident journeys'],
    icon: 'block-housing',
  },
  {
    id: 'healthcare',
    name: 'Healthcare',
    category: 'service',
    cost: 2,
    description: 'Provides essential medical access.',
    benefits: ['Improves accessibility for nearby housing'],
    tradeoffs: ['Poor placement increases journey time for some residents'],
    icon: 'block-healthcare',
  },
  {
    id: 'education',
    name: 'Education',
    category: 'service',
    cost: 2,
    description: 'Schools and learning spaces for children and lifelong learners.',
    benefits: ['Improves outcomes for families with children'],
    tradeoffs: ['Needs safe, short routes for young residents'],
    icon: 'block-education',
  },
  {
    id: 'transport',
    name: 'Transport',
    category: 'infrastructure',
    cost: 1,
    description: 'Connects blocks together, shortening journeys across the city.',
    benefits: ['Reduces travel time between distant blocks'],
    tradeoffs: ['Without accessible design, it can exclude wheelchair users'],
    icon: 'block-transport',
  },
  {
    id: 'park',
    name: 'Park',
    category: 'community',
    cost: 1,
    description: 'Green, shared outdoor space.',
    benefits: ['Improves sustainability and community wellbeing'],
    tradeoffs: ['Uses budget without directly improving accessibility'],
    icon: 'block-park',
  },
  {
    id: 'community_hub',
    name: 'Community Hub',
    category: 'community',
    cost: 2,
    description: 'A shared gathering space for local groups and events.',
    benefits: ['Strengthens community connection across personas'],
    tradeoffs: ['Most effective only within easy walking distance'],
    icon: 'block-community-hub',
  },
  {
    id: 'technology_hub',
    name: 'Technology Hub',
    category: 'technology',
    cost: 3,
    description: 'Digital access point — devices, connectivity and digital skills support.',
    benefits: ['Improves inclusion for residents with limited digital access'],
    tradeoffs: ['High cost relative to its footprint'],
    icon: 'block-technology-hub',
  },
  {
    id: 'shared_resource_hub',
    name: 'Shared Resource Hub',
    category: 'community',
    cost: 2,
    description: 'A library-of-things: tools, equipment and skills residents borrow instead of buying.',
    benefits: ['Reduces resource duplication across households'],
    tradeoffs: ['Needs steady foot traffic to stay useful'],
    icon: 'block-shared-resource-hub',
  },
  {
    id: 'culture_heritage',
    name: 'Culture & Heritage',
    category: 'culture',
    cost: 2,
    description: 'Preserves and celebrates local history and cultural identity.',
    benefits: ['Improves community and inclusion for long-term and non-English-speaking residents alike'],
    tradeoffs: ['Converting heritage sites can conflict with new development'],
    icon: 'block-culture-heritage',
  },
];

/* ----------------------------------------------------------------- personas */

export const PERSONAS: Persona[] = [
  {
    id: 'older_resident',
    name: 'Older resident',
    description: 'Values short, familiar, low-effort journeys and easy access to healthcare.',
    priorityServices: ['healthcare', 'community_hub', 'park'],
    accessibilityNeeds: ['step_free_routes', 'seating_along_routes'],
    maxComfortableJourneyMinutes: 12,
  },
  {
    id: 'wheelchair_user',
    name: 'Wheelchair user',
    description: 'Affected by inaccessible routes, stairs and unsuitable transport connections.',
    priorityServices: ['healthcare', 'transport'],
    accessibilityNeeds: ['step_free_routes', 'accessible_transport'],
    maxComfortableJourneyMinutes: 15,
  },
  {
    id: 'parent_stroller',
    name: 'Parent with stroller',
    description: 'Needs wide, step-free routes and nearby education and healthcare.',
    priorityServices: ['education', 'healthcare', 'park'],
    accessibilityNeeds: ['step_free_routes', 'wide_paths'],
    maxComfortableJourneyMinutes: 15,
  },
  {
    id: 'child_student',
    name: 'Child / student',
    description: 'Travels to education daily; route safety matters as much as distance.',
    priorityServices: ['education', 'park', 'community_hub'],
    accessibilityNeeds: ['safe_crossings'],
    maxComfortableJourneyMinutes: 10,
  },
  {
    id: 'remote_worker',
    name: 'Remote worker',
    description: 'Relies on reliable connectivity and occasional shared workspace access.',
    priorityServices: ['technology_hub', 'shared_resource_hub'],
    accessibilityNeeds: [],
    maxComfortableJourneyMinutes: 20,
  },
  {
    id: 'limited_digital_access',
    name: 'Limited digital access',
    description: 'Needs in-person alternatives to digital-only services.',
    priorityServices: ['technology_hub', 'community_hub'],
    accessibilityNeeds: ['in_person_alternatives'],
    maxComfortableJourneyMinutes: 15,
  },
  {
    id: 'non_english_speaker',
    name: 'Non-English speaker',
    description: 'Benefits most from community and culture spaces offering multilingual support.',
    priorityServices: ['community_hub', 'education', 'culture_heritage'],
    accessibilityNeeds: ['multilingual_support'],
    maxComfortableJourneyMinutes: 15,
  },
];

/* ---------------------------------------------------- the flawed demo city */

/**
 * Demo step 2 from the proposal doc: "build a deliberately unbalanced city".
 * Housing is clustered in the north, healthcare sits in the far south-east corner,
 * and the two transport blocks do not join them up - so the wheelchair user's route
 * to healthcare fails, which is exactly what the demo needs to show.
 *
 * Cost: 26 of the 100-block budget, leaving room to rebuild on stage.
 */
/**
 * The seeded demo city.
 *
 * Hand-placing a 30x30 city is not sensible, so this is the generator's output at a fixed
 * seed: deterministic, deliberately flawed, and regenerated by changing the seed rather
 * than by editing coordinates. See shared/src/generation.ts.
 */
export const DEMO_CITY_BLOCKS: PlacedBlockInput[] = generateCity({
  seed: 'demo-21',
  archetypeId: 'organic_town',
  gridWidth: DEFAULT_GRID_WIDTH,
  gridHeight: DEFAULT_GRID_HEIGHT,
  blockBudget: DEFAULT_BLOCK_BUDGET,
  blockTypes: BLOCK_TYPES,
  personas: PERSONAS,
  defects: 2,
}).blocks;

/**
 * The council's official city - a fixed, hand-placed layout every user sees the same
 * way. This is what the seeded proposals below describe changes against (the heritage
 * removal targets the culture_heritage block at (0, 9), the garden proposal targets the
 * empty cell next to the existing park at (2, 7), and so on) - coordinates that only
 * line up against THIS layout, not the procedurally-generated personal city.
 *
 * Deliberately spacious and deliberately flawed (housing clustered north, healthcare in
 * the far south-east, the two transport blocks not actually connecting them) - this is
 * the "build a flawed city" city from the demo script. It never changes at runtime: there
 * are no blocks/place/move/remove endpoints for it, only GET /cities/council.
 */
export const COUNCIL_CITY_GRID_WIDTH = 16;
export const COUNCIL_CITY_GRID_HEIGHT = 16;
export const COUNCIL_CITY_BLOCK_BUDGET = 100;

export const COUNCIL_CITY_BLOCKS: PlacedBlockInput[] = [
  { typeId: 'housing', x: 2, y: 2 },
  { typeId: 'housing', x: 3, y: 2 },
  { typeId: 'housing', x: 4, y: 2 },
  { typeId: 'housing', x: 2, y: 3 },
  { typeId: 'housing', x: 3, y: 3 },
  { typeId: 'housing', x: 4, y: 3 },
  { typeId: 'housing', x: 5, y: 2 },
  { typeId: 'housing', x: 5, y: 3 },
  { typeId: 'housing', x: 10, y: 3 },
  { typeId: 'housing', x: 11, y: 3 },
  { typeId: 'housing', x: 10, y: 4 },
  { typeId: 'housing', x: 11, y: 4 },
  { typeId: 'transport', x: 7, y: 1 },
  { typeId: 'transport', x: 7, y: 8 },
  { typeId: 'transport', x: 4, y: 12 },
  { typeId: 'community_hub', x: 6, y: 5 },
  { typeId: 'community_hub', x: 4, y: 9 },
  { typeId: 'education', x: 12, y: 5 },
  { typeId: 'education', x: 12, y: 7 },
  { typeId: 'technology_hub', x: 7, y: 6 },
  { typeId: 'technology_hub', x: 8, y: 12 },
  { typeId: 'park', x: 2, y: 7 },
  { typeId: 'park', x: 10, y: 9 },
  { typeId: 'shared_resource_hub', x: 7, y: 10 },
  { typeId: 'healthcare', x: 12, y: 11 },
  { typeId: 'culture_heritage', x: 0, y: 9 },
];

/* ---------------------------------------------------------------- proposals */

export interface SeedProposal extends ProposalInput {
  id: string;
  /** Seed ballots as support/oppose counts per metric. Stored as ordinary vote rows. */
  seedVotes: Record<string, { support: number; oppose: number }>;
  /** Distinct seed voters - every seed user casts a full ballot. */
  seedVoterCount: number;
}

/**
 * The proposals BE #2 seeds. The first one is THE DEFAULT: Proposal mode must never be
 * empty on a cold start, so the garden ships with its issue, its map change and enough
 * ballots to make the results interesting. The other two are extras that make the demo
 * richer - the garden is loved but questioned on cost, transport splits the city on
 * efficiency, and the heritage conversion is genuinely contested.
 */
export const SEED_PROPOSALS: SeedProposal[] = [
  {
    id: 'prp_garden1',
    title: 'Add a community garden',
    issue:
      'The northern housing cluster has no green or shared space within walking distance, so nobody has anywhere to meet.',
    description:
      'Convert one block near the northern housing into a shared community garden, with raised beds and a covered meeting area.',
    location: { x: 2, y: 6 },
    changes: [{ op: 'place', typeId: 'park', x: 2, y: 6 }],
    blockCost: 2,
    expectedBenefits: ['Community connection', 'Sustainability', 'Shared food growing'],
    affectedPersonaIds: ['older_resident', 'parent_stroller', 'non_english_speaker'],
    votingMetrics: ['community', 'sustainability', 'accessibility', 'efficiency'],
    seedVoterCount: 24,
    seedVotes: {
      community: { support: 22, oppose: 2 },
      sustainability: { support: 17, oppose: 7 },
      accessibility: { support: 20, oppose: 4 },
      efficiency: { support: 14, oppose: 10 },
    },
  },
  {
    id: 'prp_transport1',
    title: 'Expand public transport',
    issue:
      'A wheelchair user in the north cannot reach the healthcare centre - the only route is long and has no transport connection.',
    description:
      'Add a transport link running north to south so the northern housing cluster can reach the healthcare centre without a long walk.',
    location: { x: 5, y: 4 },
    changes: [
      { op: 'place', typeId: 'transport', x: 5, y: 4 },
      { op: 'place', typeId: 'transport', x: 5, y: 6 },
    ],
    blockCost: 6,
    expectedBenefits: ['Accessibility', 'Step-free routes to healthcare', 'Shorter journeys'],
    affectedPersonaIds: ['wheelchair_user', 'older_resident', 'child_student'],
    votingMetrics: ['accessibility', 'efficiency', 'sustainability', 'inclusion'],
    seedVoterCount: 31,
    seedVotes: {
      accessibility: { support: 28, oppose: 3 },
      efficiency: { support: 15, oppose: 16 },
      sustainability: { support: 22, oppose: 9 },
      inclusion: { support: 26, oppose: 5 },
    },
  },
  {
    id: 'prp_heritage1',
    title: 'Convert heritage site into new development',
    issue:
      'The south-west has no room left for services, and the only free land is the heritage block.',
    description:
      'Replace the heritage block in the south-west with mixed-use development, freeing space for services but removing the oldest building in the city.',
    location: { x: 0, y: 9 },
    changes: [{ op: 'remove', x: 0, y: 9 }],
    blockCost: 4,
    expectedBenefits: ['Frees development space', 'Room for additional services'],
    affectedPersonaIds: ['non_english_speaker', 'older_resident', 'remote_worker'],
    votingMetrics: ['community', 'resilience', 'efficiency', 'sustainability'],
    seedVoterCount: 27,
    seedVotes: {
      community: { support: 8, oppose: 19 },
      resilience: { support: 12, oppose: 15 },
      efficiency: { support: 17, oppose: 10 },
      sustainability: { support: 9, oppose: 18 },
    },
  },
];

export const ALL_METRICS: MetricName[] = [
  'accessibility',
  'sustainability',
  'efficiency',
  'community',
  'resilience',
  'inclusion',
];
