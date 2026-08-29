import type { BlockType, Persona } from '../city.schemas.js';
import blockTypesData from './block-types.json' with { type: 'json' };
import personasData from './personas.json' with { type: 'json' };

export const blockTypes = blockTypesData as BlockType[];

export const personas = personasData as Persona[];

/** Budget cost per block-type id (see specs/city-service.yaml — blocksUsed is Σ cost). */
export const BLOCK_COST: Record<string, number> = Object.fromEntries(
  blockTypes.map((b) => [b.id, b.cost]),
);

export function isKnownBlockType(typeId: string): boolean {
  return blockTypes.some((b) => b.id === typeId);
}
