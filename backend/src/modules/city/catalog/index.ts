import type { BlockType } from '../city.schemas.js';
import blockTypesData from './block-types.json' with { type: 'json' };

export const blockTypes = blockTypesData as BlockType[];

export function isKnownBlockType(typeId: string): boolean {
  return blockTypes.some((b) => b.id === typeId);
}
