import { BLOCK_COST } from './catalog/index.js';
import type { City, PlacedBlock } from './city.schemas.js';

export const COUNCIL_CITY_GRID_WIDTH = 16;
export const COUNCIL_CITY_GRID_HEIGHT = 16;
// One point of budget per grid cell, matching web/src/mocks/fixtures.ts.
export const COUNCIL_CITY_BLOCK_BUDGET = 256;

const COUNCIL_CITY_BLOCKS = [
  ['housing', 2, 2],
  ['housing', 3, 2],
  ['housing', 4, 2],
  ['housing', 2, 3],
  ['housing', 3, 3],
  ['housing', 4, 3],
  ['housing', 5, 2],
  ['housing', 5, 3],
  ['housing', 10, 3],
  ['housing', 11, 3],
  ['housing', 10, 4],
  ['housing', 11, 4],
  ['transport', 7, 1],
  ['transport', 7, 8],
  ['transport', 4, 12],
  ['community_hub', 6, 5],
  ['community_hub', 4, 9],
  ['education', 12, 5],
  ['education', 12, 7],
  ['technology_hub', 7, 6],
  ['technology_hub', 8, 12],
  ['park', 10, 9],
  ['shared_resource_hub', 7, 10],
  ['healthcare', 12, 11],
  ['culture_heritage', 0, 9],

  // --- the garden site: see COUNCIL_CITY_BLOCKS in web/src/mocks/fixtures.ts for
  // why the park at (2, 7) was removed and (2, 6) must stay empty.
  ['housing', 2, 5],
  ['housing', 1, 6],
  ['housing', 1, 7],
  ['housing', 2, 8],

  // --- outskirts: keep in sync with COUNCIL_CITY_BLOCKS in
  // web/src/mocks/fixtures.ts, which documents why the north stays green-free
  // and why (2, 6), (5, 4) and (5, 6) must stay empty.
  ['housing', 2, 0],
  ['housing', 3, 0],
  ['housing', 4, 0],
  ['housing', 1, 2],
  ['housing', 1, 3],
  ['housing', 10, 1],
  ['housing', 11, 1],
  ['housing', 10, 2],
  ['housing', 11, 2],
  ['housing', 12, 2],
  ['housing', 13, 5],
  ['housing', 13, 6],
  ['housing', 13, 7],
  ['housing', 13, 8],
  ['park', 14, 6],
  ['park', 14, 7],
  ['housing', 13, 10],
  ['housing', 13, 11],
  ['housing', 14, 11],
  ['park', 14, 10],
  ['housing', 5, 13],
  ['housing', 6, 13],
  ['housing', 7, 13],
  ['education', 8, 13],
  ['park', 6, 14],
  ['park', 7, 14],
  ['park', 8, 14],
  ['housing', 10, 13],
  ['housing', 11, 13],
  ['culture_heritage', 12, 13],
  ['community_hub', 13, 13],
  ['park', 11, 14],
  ['park', 12, 14],
  ['housing', 1, 11],
  ['housing', 2, 11],
  ['housing', 1, 12],
  ['housing', 2, 12],
  ['housing', 1, 13],
  ['housing', 2, 13],
  ['park', 0, 12],
  ['park', 0, 13],
  ['park', 1, 10],
  ['park', 0, 11],
  ['park', 0, 14],
  ['park', 1, 14],
  ['park', 2, 14],
  ['park', 15, 6],
  ['park', 15, 7],
  ['park', 15, 10],
  ['park', 15, 11],
  ['park', 15, 13],
  ['park', 14, 13],
  ['park', 13, 14],
  ['park', 4, 15],
  ['park', 5, 15],
  ['park', 9, 15],
  ['park', 10, 15],
  ['housing', 6, 15],
  ['housing', 7, 15],
  ['housing', 8, 15],
  ['housing', 14, 5],
  // --- centre district: see web/src/mocks/fixtures.ts for why the cells directly
  // in front of (2, 6), (5, 4) and (5, 6) are deliberately left open.
  ['housing', 1, 4],
  ['housing', 2, 4],
  ['housing', 3, 4],
  ['housing', 0, 5],
  ['housing', 1, 5],
  ['housing', 3, 5],
  ['housing', 0, 6],
  ['housing', 0, 7],
  ['housing', 0, 8],
  ['housing', 1, 8],
  ['housing', 4, 5],
  ['housing', 4, 6],
  ['housing', 8, 4],
  ['housing', 9, 4],
  ['housing', 8, 5],
  ['housing', 9, 5],
  ['housing', 8, 6],
  ['housing', 9, 6],
  ['housing', 8, 7],
  ['housing', 9, 7],
  ['housing', 8, 8],
  ['housing', 9, 8],
  ['housing', 8, 9],
  ['housing', 9, 9],
  ['housing', 8, 10],
  ['housing', 9, 10],
] as const;

/** How many blocks the council layout ships with. Asserted in the API tests. */
export const COUNCIL_CITY_BLOCK_COUNT = COUNCIL_CITY_BLOCKS.length;

const COUNCIL_CITY_CREATED_AT = '2026-01-01T00:00:00.000Z';

/** Fixed, read-only city used by Proposal mode for every authenticated user. */
export function getCouncilCity(): City {
  const blocks: PlacedBlock[] = COUNCIL_CITY_BLOCKS.map(([typeId, x, y], index) => ({
    id: `cblk_${String(index + 1).padStart(2, '0')}`,
    typeId,
    x,
    y,
  }));

  return {
    id: 'cty_council',
    ownerId: 'council',
    name: 'Sydney',
    gridWidth: COUNCIL_CITY_GRID_WIDTH,
    gridHeight: COUNCIL_CITY_GRID_HEIGHT,
    blockBudget: COUNCIL_CITY_BLOCK_BUDGET,
    blocksUsed: blocks.reduce((total, block) => total + (BLOCK_COST[block.typeId] ?? 0), 0),
    blocks,
    lastSimulation: null,
    createdAt: COUNCIL_CITY_CREATED_AT,
    updatedAt: COUNCIL_CITY_CREATED_AT,
  };
}
