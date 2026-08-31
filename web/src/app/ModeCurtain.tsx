import { useCallback, useEffect, useRef, useState } from 'react';
import { cx } from '@/lib/format';

/**
 * The curtain that covers a mode switch.
 *
 * Simulation and Proposal render two different cities on two different canvases, so
 * switching between them tears down one Phaser game and boots another. That takes a
 * few hundred milliseconds of blank canvas, half-loaded map and re-fitting camera -
 * honest work, but it reads as a bug.
 *
 * So the switch happens behind a curtain: two panels close over the map, the actual
 * navigation runs while they are shut, and they part again once the new map has had
 * time to draw itself. The user never sees the seam.
 */

/** Panels closing, ms. */
const CLOSE_MS = 300;
/** How long the map gets to swap and draw while covered, ms. */
const HOLD_MS = 320;
/** Panels parting, ms. */
const OPEN_MS = 380;

type Phase = 'idle' | 'closing' | 'held' | 'opening';

export interface ModeTransition {
  /** True while the panels are shut or moving - the curtain is on screen. */
  active: boolean;
  covered: boolean;
  label: string;
  /** Run `action` behind the curtain. Falls straight through if one is in flight. */
  run: (label: string, action: () => void) => void;
}

export function useModeTransition(): ModeTransition {
  const [phase, setPhase] = useState<Phase>('idle');
  const [label, setLabel] = useState('');
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => {
      for (const id of timers.current) window.clearTimeout(id);
    },
    [],
  );

  const run = useCallback(
    (nextLabel: string, action: () => void) => {
      // A second switch mid-animation would run its action behind a curtain that is
      // already parting, which is the flicker this exists to prevent.
      if (phase !== 'idle') return;

      setLabel(nextLabel);
      setPhase('closing');

      const after = (ms: number, fn: () => void) => {
        timers.current.push(window.setTimeout(fn, ms));
      };

      after(CLOSE_MS, () => {
        // Fully covered: swap the map now, while nothing of it is visible.
        action();
        setPhase('held');
      });
      after(CLOSE_MS + HOLD_MS, () => setPhase('opening'));
      after(CLOSE_MS + HOLD_MS + OPEN_MS, () => setPhase('idle'));
    },
    [phase],
  );

  return {
    active: phase !== 'idle',
    covered: phase === 'closing' || phase === 'held',
    label,
    run,
  };
}

export function ModeCurtain({ active, covered, label }: Omit<ModeTransition, 'run'>) {
  if (!active) return null;

  // Each panel covers just over half the screen, so they overlap at the seam rather
  // than leaving a hairline of map showing between them.
  const panel =
    'absolute inset-x-0 h-[51%] bg-paper-50 bg-blueprint transition-transform ease-in-out motion-reduce:transition-none';

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[900] overflow-hidden"
    >
      <div
        className={cx(panel, 'top-0 border-b-2 border-ink/10')}
        style={{
          transform: covered ? 'translateY(0)' : 'translateY(-101%)',
          transitionDuration: `${covered ? CLOSE_MS : OPEN_MS}ms`,
        }}
      />
      <div
        className={cx(panel, 'bottom-0 border-t-2 border-ink/10')}
        style={{
          transform: covered ? 'translateY(0)' : 'translateY(101%)',
          transitionDuration: `${covered ? CLOSE_MS : OPEN_MS}ms`,
        }}
      />
      <p
        className={cx(
          'absolute inset-0 flex items-center justify-center',
          'font-display text-sm font-extrabold tracking-[0.16em] text-muted uppercase',
          'transition-opacity duration-200 motion-reduce:transition-none',
          covered ? 'opacity-100' : 'opacity-0',
        )}
      >
        {label}
      </p>
    </div>
  );
}
