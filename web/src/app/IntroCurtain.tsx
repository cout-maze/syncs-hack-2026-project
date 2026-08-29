import { Fragment, useEffect, useState } from 'react';
import { BLOCK_COLORS, shadeHex } from '@/lib/visuals';
import { cx } from '@/lib/format';

/**
 * The landing curtain.
 *
 * Covers the screen while Phaser boots and the city loads. A small isometric grid
 * assembles itself back-to-front, deliberately leaving one gap; the missing block
 * drops into it, the wordmark resolves, and the whole plate lifts away.
 *
 * It never blocks the product: it leaves as soon as the map is ready and the minimum
 * beat has played, and it gives up after MAX_WAIT_MS even if the map never reports in.
 */

const GRID = 5;
/** Index of the deliberately empty plot, in (x, y). */
const GAP = { x: 2, y: 2 };

const TILE_W = 46;
const TILE_H = 23;
const CUBE_H = 19;

/** Timing, in ms. */
const STEP = 62;
/** Every other block has landed and settled by ~1.1s; the gap then reads for a beat. */
const LAST_BLOCK_AT = (GRID - 1) * 2 * STEP + 780;
const TITLE_AT = LAST_BLOCK_AT + 260;
const MIN_VISIBLE_MS = TITLE_AT + 900;
const MAX_WAIT_MS = 8000;
const EXIT_MS = 620;

const PALETTE = Object.values(BLOCK_COLORS);

export function IntroCurtain({ ready }: { ready: boolean }) {
  const [minElapsed, setMinElapsed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const min = window.setTimeout(() => setMinElapsed(true), MIN_VISIBLE_MS);
    // Safety valve: never trap the user behind the curtain if the map fails to boot.
    const bail = window.setTimeout(() => setLeaving(true), MAX_WAIT_MS);
    return () => {
      window.clearTimeout(min);
      window.clearTimeout(bail);
    };
  }, []);

  useEffect(() => {
    if (ready && minElapsed) setLeaving(true);
  }, [ready, minElapsed]);

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setGone(true), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  if (gone) return null;

  const cells: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) cells.push({ x, y });
  }
  // Painter's order: back of the grid first, so the stack reads as depth.
  cells.sort((a, b) => a.x + a.y - (b.x + b.y));

  const width = GRID * TILE_W + TILE_W;
  const originX = width / 2;
  const originY = CUBE_H + TILE_H;
  // Exactly the box the cubes occupy, so the title sits at a deliberate distance.
  const height = originY + (GRID - 1) * TILE_H + TILE_H;

  const gapCentre = {
    x: originX + (GAP.x - GAP.y) * (TILE_W / 2),
    y: originY + (GAP.x + GAP.y) * (TILE_H / 2),
  };

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading The Missing Block"
      className={cx(
        'fixed inset-0 z-[1000] flex flex-col items-center justify-center gap-6',
        'bg-paper-50 bg-blueprint',
        leaving && 'pointer-events-none rmc-curtain-lift',
      )}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        className="overflow-visible"
      >
        {cells.map(({ x, y }, index) => {
          const isGap = x === GAP.x && y === GAP.y;
          const cx0 = originX + (x - y) * (TILE_W / 2);
          const cy0 = originY + (x + y) * (TILE_H / 2);
          // The gap waits for everything else, then drops in as the last block.
          const delay = isGap ? LAST_BLOCK_AT : (x + y) * STEP;
          const color = isGap ? '#9c5f0f' : (PALETTE[index % PALETTE.length] as string);

          return (
            <Fragment key={`${x}-${y}`}>
              {/* The empty plot, outlined until its block lands. Drawn at the gap's
                  own depth so the cubes in front of it still paint over the top. */}
              {isGap && (
                <polygon
                  points={[
                    `${gapCentre.x},${gapCentre.y - TILE_H / 2}`,
                    `${gapCentre.x + TILE_W / 2 - 2},${gapCentre.y}`,
                    `${gapCentre.x},${gapCentre.y + TILE_H / 2}`,
                    `${gapCentre.x - TILE_W / 2 + 2},${gapCentre.y}`,
                  ].join(' ')}
                  fill="#9c5f0f"
                  fillOpacity={0.12}
                  stroke="#9c5f0f"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  className="rmc-fade-out"
                  style={{ animationDelay: `${LAST_BLOCK_AT + 120}ms` }}
                />
              )}

              <g
                className="rmc-block-in"
                style={{
                  animationDelay: `${delay}ms`,
                  transformOrigin: `${cx0}px ${cy0}px`,
                }}
              >
                <Cube cx={cx0} cy={cy0} color={color} />
              </g>

              {isGap && (
                <ellipse
                  cx={gapCentre.x}
                  cy={gapCentre.y}
                  rx={TILE_W / 2}
                  ry={TILE_H / 2}
                  fill="none"
                  stroke="#9c5f0f"
                  strokeWidth={2}
                  className="rmc-ring-out"
                  style={{
                    animationDelay: `${LAST_BLOCK_AT + 280}ms`,
                    transformOrigin: `${gapCentre.x}px ${gapCentre.y}px`,
                    opacity: 0,
                  }}
                />
              )}
            </Fragment>
          );
        })}
      </svg>

      <div className="flex flex-col items-center gap-2 px-6 text-center">
        <h1
          className="rmc-rise-in font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl"
          style={{ animationDelay: `${TITLE_AT}ms` }}
        >
          The Missing Block
        </h1>
        <p
          className="rmc-rise-in max-w-sm text-sm text-balance text-muted"
          style={{ animationDelay: `${TITLE_AT + 140}ms` }}
        >
          Every block changes what happens to everyone else.
        </p>
      </div>
    </div>
  );
}

/** One isometric cube: top face plus the two visible sides. */
function Cube({ cx: x, cy: y, color }: { cx: number; cy: number; color: string }) {
  const halfW = TILE_W / 2 - 2;
  const halfH = TILE_H / 2 - 1;

  return (
    <>
      {/* left face - pre-mixed darker, not opacity: opacity would blend toward the
          page colour, and this page is now light, which would lighten the face
          instead of shading it. */}
      <polygon
        points={`${x - halfW},${y} ${x},${y + halfH} ${x},${y + halfH - CUBE_H} ${x - halfW},${y - CUBE_H}`}
        fill={shadeHex(color, 0.62)}
      />
      {/* right face */}
      <polygon
        points={`${x},${y + halfH} ${x + halfW},${y} ${x + halfW},${y - CUBE_H} ${x},${y + halfH - CUBE_H}`}
        fill={shadeHex(color, 0.42)}
      />
      {/* top face */}
      <polygon
        points={`${x},${y - halfH - CUBE_H} ${x + halfW},${y - CUBE_H} ${x},${y + halfH - CUBE_H} ${x - halfW},${y - CUBE_H}`}
        fill={color}
      />
    </>
  );
}
