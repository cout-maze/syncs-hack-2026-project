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

const ZONE_STOPS: Array<{ at: number; color: [number, number, number] }> = [
  { at: 0, color: [0xff, 0x3f, 0x55] },
  { at: 50, color: [0xff, 0xb0, 0x00] },
  { at: 100, color: [0x20, 0xe8, 0x78] },
];

/** Map a 0-100 accessibility score from struggling red to well-served green. */
export function zoneColor(score: number): string {
  const clamped = Math.max(0, Math.min(100, score));
  const low = clamped <= 50 ? ZONE_STOPS[0]! : ZONE_STOPS[1]!;
  const high = clamped <= 50 ? ZONE_STOPS[1]! : ZONE_STOPS[2]!;
  const t = clamped <= 50 ? clamped / 50 : (clamped - 50) / 50;
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  const [r, g, b] = [
    mix(low.color[0], high.color[0]),
    mix(low.color[1], high.color[1]),
    mix(low.color[2], high.color[2]),
  ];
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

/** Phaser wants 0xRRGGBB. */
export function toPhaserColor(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16);
}
