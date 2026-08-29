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
  housing: '#f8f8f4',
  healthcare: '#dd4b58',
  education: '#6070e0',
  transport: '#1f88bd',
  park: '#2f9c68',
  community_hub: '#c78a1f',
  technology_hub: '#8858d4',
  shared_resource_hub: '#1a9e8f',
  culture_heritage: '#c94488',
};

/**
 * The dock/UI variant of the block palette.
 *
 * BLOCK_COLORS is tuned for buildings standing on the map's near-white city, where
 * housing is deliberately almost white. That tone vanishes on the light page, so the
 * UI palette swaps it for the terracotta the map already uses on housing roofs.
 * Everything else is the same colour in both places.
 */
export const BLOCK_ICON_COLORS: Record<BlockTypeId, string> = {
  ...BLOCK_COLORS,
  housing: '#d08663',
};

export function blockIconColor(typeId: string): string {
  return BLOCK_ICON_COLORS[typeId as BlockTypeId] ?? '#8c7a56';
}

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

/** Blend a "#rrggbb" colour toward white. The lightening counterpart of shadeHex,
 *  used for the second tone in the two-tone block icons. */
export function tintHex(hex: string, amount: number): string {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const channel = (shift: number) => {
    const value = (n >> shift) & 0xff;
    return Math.round(value + (255 - value) * amount);
  };
  const [r, g, b] = [channel(16), channel(8), channel(0)];
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
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
