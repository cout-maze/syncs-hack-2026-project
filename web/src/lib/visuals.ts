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
  housing: '#e8825a',
  healthcare: '#ef5f6b',
  education: '#7b8cf5',
  transport: '#46a6d6',
  park: '#57bf86',
  community_hub: '#f2a93b',
  technology_hub: '#a472e8',
  shared_resource_hub: '#35bfb0',
  culture_heritage: '#e070a8',
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
  accessibility: '#46a6d6',
  sustainability: '#57bf86',
  efficiency: '#f2a93b',
  community: '#e8825a',
  resilience: '#a472e8',
  inclusion: '#35bfb0',
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
  return BLOCK_COLORS[typeId as BlockTypeId] ?? '#7a89ad';
}

export function blockGlyph(typeId: string): string {
  return BLOCK_GLYPHS[typeId as BlockTypeId] ?? '\u{2B1B}';
}

export function personaGlyph(personaId: string): string {
  return PERSONA_GLYPHS[personaId as PersonaId] ?? '\u{1F464}';
}

export function metricColor(metric: string): string {
  return METRIC_COLORS[metric as MetricName] ?? '#7a89ad';
}

/** Phaser wants 0xRRGGBB. */
export function toPhaserColor(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16);
}
