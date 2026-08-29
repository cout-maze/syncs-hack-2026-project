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
    cost: 1,
    description: 'Homes for residents. Every journey in the city starts here.',
    benefits: ['Adds population coverage to the surrounding area'],
    tradeoffs: ['More housing increases demand on nearby services'],
    icon: 'block-housing',
  },
  {
    id: 'healthcare',
    name: 'Healthcare',
    category: 'service',
    cost: 3,
    description: 'Essential medical access for every resident.',
    benefits: ['Improves accessibility for nearby housing'],
    tradeoffs: ['Poor placement increases journey time for some residents'],
    icon: 'block-healthcare',
  },
  {
    id: 'education',
    name: 'Education',
    category: 'service',
    cost: 2,
    description: 'Schools and learning spaces for children and families.',
    benefits: ['Supports students and parents nearby'],
    tradeoffs: ['Distance and transport connections strongly affect access'],
    icon: 'block-education',
  },
  {
    id: 'transport',
    name: 'Transport',
    category: 'infrastructure',
    cost: 2,
    description: 'Connects neighbourhoods to essential services.',
    benefits: ['Shortens journeys along its route', 'Enables step-free travel'],
    tradeoffs: ['Uses limited space and budget'],
    icon: 'block-transport',
  },
  {
    id: 'park',
    name: 'Park',
    category: 'community',
    cost: 1,
    description: 'Public green space for wellbeing and social connection.',
    benefits: ['Improves community connection and sustainability'],
    tradeoffs: ['Consumes development space'],
    icon: 'block-park',
  },
  {
    id: 'community_hub',
    name: 'Community hub',
    category: 'community',
    cost: 2,
    description: 'A place for social interaction and shared activities.',
    benefits: ['Strong community benefit', 'Supports residents who need in-person services'],
    tradeoffs: ['Competes for central space'],
    icon: 'block-community-hub',
  },
  {
    id: 'technology_hub',
    name: 'Technology hub',
    category: 'technology',
    cost: 3,
    description: 'Digital infrastructure that improves information and service efficiency.',
    benefits: ['Improves efficiency across the city'],
    tradeoffs: ['May increase digital exclusion or dependency'],
    icon: 'block-technology-hub',
  },
  {
    id: 'shared_resource_hub',
    name: 'Shared resource hub',
    category: 'community',
    cost: 2,
    description: 'Tools, equipment and facilities shared across neighbourhoods.',
    benefits: ['Efficient use of scarce resources'],
    tradeoffs: ['Only works if residents can actually reach it'],
    icon: 'block-shared-resource-hub',
  },
  {
    id: 'culture_heritage',
    name: 'Culture & heritage',
    category: 'culture',
    cost: 2,
    description: 'Preserves the identity, history and cultural life of the city.',
    benefits: ['Strengthens cultural connection and belonging'],
    tradeoffs: ['Preservation uses valuable development space'],
    icon: 'block-culture-heritage',
  },
];

/* ----------------------------------------------------------------- personas */

export const PERSONAS: Persona[] = [
  {
    id: 'older_resident',
    name: 'Older resident',
    description: 'Prioritises short, simple and physically accessible journeys.',
    priorityServices: ['healthcare', 'park', 'community_hub'],
    accessibilityNeeds: ['short_journeys', 'seating_on_route'],
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
    description: 'Benefits from safe, convenient routes and nearby essential services.',
    priorityServices: ['education', 'park', 'healthcare'],
    accessibilityNeeds: ['step_free_routes', 'safe_crossings'],
    maxComfortableJourneyMinutes: 15,
  },
  {
    id: 'child_student',
    name: 'Child / student',
    description: 'Depends on education access, safe travel and community spaces.',
    priorityServices: ['education', 'park', 'community_hub'],
    accessibilityNeeds: ['safe_crossings'],
    maxComfortableJourneyMinutes: 20,
  },
  {
    id: 'remote_worker',
    name: 'Remote worker',
    description: 'Benefits from technology and community infrastructure; different mobility needs.',
    priorityServices: ['technology_hub', 'community_hub', 'transport'],
    accessibilityNeeds: [],
    maxComfortableJourneyMinutes: 25,
  },
  {
    id: 'limited_digital_access',
    name: 'Resident with limited digital access',
    description: 'Disadvantaged when essential services become overly dependent on technology.',
    priorityServices: ['community_hub', 'shared_resource_hub', 'healthcare'],
    accessibilityNeeds: ['in_person_services'],
    maxComfortableJourneyMinutes: 15,
  },
  {
    id: 'non_english_speaker',
    name: 'Resident from a non-English-speaking background',
    description: 'Highlights the importance of accessible information and inclusive services.',
    priorityServices: ['community_hub', 'education', 'culture_heritage'],
    accessibilityNeeds: ['translated_information', 'in_person_services'],
    maxComfortableJourneyMinutes: 20,
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
export const DEMO_CITY_BLOCKS: PlacedBlockInput[] = [
  { typeId: 'housing', x: 11, y: 10 },
  { typeId: 'housing', x: 12, y: 10 },
  { typeId: 'housing', x: 13, y: 10 },
  { typeId: 'housing', x: 11, y: 11 },
  { typeId: 'housing', x: 12, y: 11 },
  { typeId: 'housing', x: 13, y: 11 },
  { typeId: 'housing', x: 17, y: 17 },
  { typeId: 'transport', x: 15, y: 10 },
  { typeId: 'transport', x: 15, y: 15 },
  { typeId: 'community_hub', x: 18, y: 10 },
  { typeId: 'education', x: 17, y: 11 },
  { typeId: 'technology_hub', x: 15, y: 13 },
  { typeId: 'park', x: 12, y: 16 },
  { typeId: 'shared_resource_hub', x: 15, y: 17 },
  { typeId: 'healthcare', x: 18, y: 17 },
  { typeId: 'culture_heritage', x: 10, y: 18 },
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
    location: { x: 12, y: 15 },
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
    location: { x: 15, y: 13 },
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
    location: { x: 10, y: 18 },
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
