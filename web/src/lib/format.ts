/** Small formatting helpers shared across tabs so numbers read the same everywhere. */

export function pct(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`;
}

export function minutes(value: number): string {
  const rounded = Math.round(value);
  return rounded === 1 ? '1 min' : `${rounded} min`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(then).toLocaleDateString();
}

/** Tailwind-friendly conditional class joiner. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
