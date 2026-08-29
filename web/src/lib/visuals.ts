import type { BlockTypeId, MetricName, PersonaId } from '@rmc/shared';

/**
 * The visual vocabulary, in one place.
 *
 * These hex values are the same ones declared as CSS custom properties in
 * src/styles/index.css. Tailwind classes read the CSS vars; Phaser needs raw
 * numbers. If you change a colour, change it in both — they're checked side by
 * side here on purpose.
 */

export const BLOCK_COLORS: Record<BlockTypeId, string> = {
  housing: '#d9764a',
  healthcare: '#dd4b58',
  education: '#6070e0',
  transport: '#1f88bd',
  park: '#2f9c68',
  community_hub: '#c78a1f',
  technology_hub: '#8858d4',
  shared_resource_hub: '#1a9e8f',
  culture_heritage: '#c94488',
};

/** Simple glyphs stand in until the two-tone sprite set exists. */
export const BLOCK_GLYPHS: Record<BlockTypeId, string> = {
  housing: '\u{1F3E0}',
  healthcare: '\u{1F3E5}',
  education: '\u{1F4DA}',
  transport: '\u{1F68C}',
  park: '\u{1F333}',
  community_hub: '\u{1F91D}',
  technology_hub: '\u{1F4E1}',
  shared_resource_hub: '\u{1F9F0}',
  culture_heritage: '\u{1F3DB}',
};

export const METRIC_COLORS: Record<MetricName, string> = {
  accessibility: '#1f88bd',
  sustainability: '#2f9c68',
  efficiency: '#c78a1f',
  community: '#d9764a',
  resilience: '#8858d4',
  inclusion: '#1a9e8f',
};

export const PERSONA_GLYPHS: Record<PersonaId, string> = {
  older_resident: '\u{1F475}',
  wheelchair_user: '\u{1F9BD}',
  parent_stroller: '\u{1F476}',
  child_student: '\u{1F393}',
  remote_worker: '\u{1F4BB}',
  limited_digital_access: '\u{1F4F5}',
  non_english_speaker: '\u{1F5E3}',
};

/** Catalog ids come off the wire as plain strings — look them up defensively. */
export function blockColor(typeId: string): string {
  return BLOCK_COLORS[typeId as BlockTypeId] ?? '#8c7a56';
}

export function blockGlyph(typeId: string): string {
  return BLOCK_GLYPHS[typeId as BlockTypeId] ?? '\u{2B1B}';
}

export function personaGlyph(personaId: string): string {
  return PERSONA_GLYPHS[personaId as PersonaId] ?? '\u{1F464}';
}

export function metricColor(metric: string): string {
  return METRIC_COLORS[metric as MetricName] ?? '#8c7a56';
}

/** Phaser wants 0xRRGGBB. */
export function toPhaserColor(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16);
}

/** Multiply a "#rrggbb" colour toward black. String-hex sibling of the Phaser
 *  scene's numeric `shade()` in scene/isometric.ts — used wherever a colour needs
 *  pre-mixed shading rather than opacity (opacity darkens on a dark page, but
 *  lightens on this app's paper-coloured one). */
export function shadeHex(hex: string, amount: number): string {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const r = Math.round(((n >> 16) & 0xff) * amount);
  const g = Math.round(((n >> 8) & 0xff) * amount);
  const b = Math.round((n & 0xff) * amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
