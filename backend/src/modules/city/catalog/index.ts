import type { BlockType, Persona } from '../city.schemas.js';
import blockTypesData from './block-types.json' with { type: 'json' };
import personasData from './personas.json' with { type: 'json' };

export const blockTypes = blockTypesData as BlockType[];
export const personas = personasData as Persona[];

export const blockCostById: ReadonlyMap<string, number> = new Map(
  blockTypes.map((b) => [b.id, b.cost]),
);

export function isKnownBlockType(typeId: string): boolean {
  return blockCostById.has(typeId);
}
