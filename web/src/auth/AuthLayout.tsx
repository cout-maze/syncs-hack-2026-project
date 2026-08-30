import type { ReactNode } from 'react';
import { cx } from '@/lib/format';

/**
 * A top-down plate of city blocks for the brand panel. Purely decorative — the
 * dashed honey cell is the missing block, waiting for a planner to place it.
 * Colours come straight from the block-type tokens so the plate reads as a
 * miniature of the real map.
 */
const PLATE_CELLS: Array<{ col: number; row: number; fill: string }> = [
  { col: 0, row: 0, fill: 'var(--color-block-healthcare)' },
  { col: 1, row: 0, fill: 'var(--color-block-housing)' },
  { col: 2, row: 0, fill: 'var(--color-block-park)' },
  { col: 3, row: 0, fill: 'var(--color-block-housing)' },
  // col 4, row 0 is left empty on purpose — an unbuilt corner.
  { col: 0, row: 1, fill: 'var(--color-block-housing)' },
  { col: 1, row: 1, fill: 'var(--color-block-education)' },
  { col: 2, row: 1, fill: 'var(--color-block-housing)' },
  // col 3, row 1 is the missing block.
  { col: 4, row: 1, fill: 'var(--color-block-technology_hub)' },
  { col: 0, row: 2, fill: 'var(--color-block-park)' },
  { col: 1, row: 2, fill: 'var(--color-block-housing)' },
  { col: 2, row: 2, fill: 'var(--color-block-community_hub)' },
  { col: 3, row: 2, fill: 'var(--color-block-shared_resource_hub)' },
  { col: 4, row: 2, fill: 'var(--color-block-housing)' },
  { col: 0, row: 3, fill: 'var(--color-block-culture_heritage)' },
  { col: 1, row: 3, fill: 'var(--color-block-housing)' },
  { col: 2, row: 3, fill: 'var(--color-block-transport)' },
  { col: 3, row: 3, fill: 'var(--color-block-housing)' },
  { col: 4, row: 3, fill: 'var(--color-block-park)' },
];

function MiniCity() {
  return (
    <svg
      viewBox="0 0 232 184"
      role="img"
      aria-label="A miniature city plate with one block missing"
      className="w-full max-w-[21rem]"
    >
      {PLATE_CELLS.map(({ col, row, fill }) => (
        <rect
          key={`${col}-${row}`}
          x={col * 48}
          y={row * 48}
          width={40}
          height={40}
          rx={10}
          fill={fill}
        />
      ))}
      <rect
        x={3 * 48}
        y={1 * 48}
        width={40}
        height={40}
        rx={10}
        fill="none"
        stroke="var(--color-honey)"
        strokeWidth={2}
        strokeDasharray="7 6"
        className="rmc-block-pulse"
      />
    </svg>
  );
}

function Wordmark({ inverted = false }: { inverted?: boolean }) {
  return (
    <p
      className={cx(
        'inline-flex items-center gap-2.5 font-display text-[11px] font-extrabold tracking-[0.3em] text-balance uppercase',
        inverted ? 'text-paper-0' : 'text-ink',
      )}
    >
      <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded-md bg-honey">
        <span className="size-2 rounded-[3px] bg-ink" />
      </span>
      The Missing Block
    </p>
  );
}

/** A quiet strip of map colours — the only full colour on the form card. */
const ACCENT_STRIP = [
  'bg-block-healthcare',
  'bg-block-education',
  'bg-block-transport',
  'bg-block-park',
  'bg-honey',
];

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel — black ink, so the block colours are the only brightness. */}
      <aside className="relative hidden overflow-hidden bg-ink p-12 text-paper-50 select-none lg:flex lg:flex-col lg:justify-between xl:p-16">
        <div aria-hidden="true" className="absolute inset-0 bg-blueprint opacity-20" />

        <div className="relative">
          <Wordmark inverted />
        </div>

        <div className="relative">
          <div className="rounded-card bg-paper-0/5 p-6 ring-1 ring-paper-0/10 sm:p-8">
            <MiniCity />
          </div>
        </div>

        <div className="relative max-w-sm space-y-4">
          <p className="font-display text-xl leading-snug font-extrabold text-paper-0">
            Rebuild the city, one missing block at a time.
          </p>
          <ul className="flex flex-wrap gap-2">
            {['100 blocks', '7 residents', '9 block types'].map((chip) => (
              <li
                key={chip}
                className="rounded-pill bg-paper-0/10 px-3 py-1 text-xs font-bold text-paper-50/90"
              >
                {chip}
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="flex flex-col items-center justify-center bg-paper-50 bg-blueprint px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-7 flex justify-center lg:hidden">
            <Wordmark />
          </div>

          <div className="rmc-rise-in mb-7 text-center">
            <h1 className="text-3xl font-extrabold text-balance">{title}</h1>
            <p className="mt-1.5 text-sm text-balance text-muted">{subtitle}</p>
          </div>

          <div className="rmc-rise-in [animation-delay:80ms] rounded-card bg-paper-0 p-7 shadow-[0_32px_64px_-32px_rgba(0,0,0,0.35)] ring-1 ring-line sm:p-8">
            <div aria-hidden="true" className="mb-6 flex justify-center gap-1.5">
              {ACCENT_STRIP.map((swatch) => (
                <span key={swatch} className={cx('size-2.5 rounded-[4px]', swatch)} />
              ))}
            </div>
            {children}
          </div>

          <p className="rmc-rise-in mt-5 text-center text-sm text-muted [animation-delay:160ms]">
            {footer}
          </p>
        </div>
      </main>
    </div>
  );
}
