import { BLOCK_COST } from './catalog/index.js';
import type { City, PlacedBlock } from './city.schemas.js';

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
  ['park', 2, 7],
  ['park', 10, 9],
  ['shared_resource_hub', 7, 10],
  ['healthcare', 12, 11],
  ['culture_heritage', 0, 9],
] as const;

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
    name: "The Council's City",
    gridWidth: 16,
    gridHeight: 16,
    blockBudget: 100,
    blocksUsed: blocks.reduce((total, block) => total + (BLOCK_COST[block.typeId] ?? 0), 0),
    blocks,
    lastSimulation: null,
    createdAt: COUNCIL_CITY_CREATED_AT,
    updatedAt: COUNCIL_CITY_CREATED_AT,
  };
}
