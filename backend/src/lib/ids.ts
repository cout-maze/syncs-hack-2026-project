import { customAlphabet } from 'nanoid';

// Unambiguous URL-safe alphabet (no look-alikes) — ids stay easy to read/say out loud during a demo.
const nanoid = customAlphabet('23456789abcdefghijkmnopqrstuvwxyz', 12);

/** Stable id prefixes matching the examples in specs/*.yaml (e.g. `usr_8f2k1`, `cty_a1b2c3`). */
export const IdPrefix = {
  user: 'usr',
  city: 'cty',
  block: 'blk',
  simulation: 'sim',
  proposal: 'prp',
  vote: 'vot',
} as const;

export function generateId(prefix: (typeof IdPrefix)[keyof typeof IdPrefix]): string {
  return `${prefix}_${nanoid()}`;
}
