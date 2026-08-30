/**
 * Which bus line each road cell belongs to.
 *
 * Geometry alone cannot answer this. Two bus lines running one cell apart are, cell for
 * cell, identical to a single two-lane road; three of them are identical to a grid. So
 * the renderer can't decide from adjacency whether to join two touching road cells - it
 * has to be told, and this is the record that tells it. `CityScene.transportLinks` only
 * joins neighbours that share a line id, which is what keeps parallel lines parallel.
 *
 * A cell can be on more than one line: where two lines cross, the shared cell carries
 * both ids so both lines draw straight through it.
 *
 * Keyed by cell coordinate rather than block id on purpose - block ids are reassigned by
 * the server on every save round-trip, but a road stays on the same square.
 */

export type RoadLines = Record<string, number[]>;

export const cellKey = (x: number, y: number): string => `${x},${y}`;

export function linesAt(lines: RoadLines, x: number, y: number): number[] {
  return lines[cellKey(x, y)] ?? [];
}

/** True when both cells are on at least one line together. */
export function sharesLine(lines: RoadLines, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  const first = linesAt(lines, a.x, a.y);
  if (first.length === 0) return false;
  const second = linesAt(lines, b.x, b.y);
  return first.some((id) => second.includes(id));
}

/** Record `cells` as one new line, keeping any line they were already part of. */
export function addLine(lines: RoadLines, cells: ReadonlyArray<{ x: number; y: number }>, lineId: number): RoadLines {
  const next: RoadLines = { ...lines };
  for (const cell of cells) {
    const key = cellKey(cell.x, cell.y);
    const existing = next[key] ?? [];
    if (!existing.includes(lineId)) next[key] = [...existing, lineId];
  }
  return next;
}

/** Drop cells that no longer hold a road, so ids don't accumulate on cleared ground. */
export function pruneLines(lines: RoadLines, roadCells: ReadonlySet<string>): RoadLines {
  const next: RoadLines = {};
  for (const [key, ids] of Object.entries(lines)) {
    if (roadCells.has(key)) next[key] = ids;
  }
  return next;
}

/**
 * Give a line to every road cell that hasn't got one - the generated city's roads, which
 * were never "drawn" by anybody, and anything placed before this record existed.
 *
 * Decomposes them into maximal straight runs: every horizontal run becomes a line, every
 * vertical run becomes a line, and a cell where the two meet (a bend or a crossing) ends
 * up on both, so it still draws through in both directions.
 */
export function assignMissingLines(
  lines: RoadLines,
  roadCells: ReadonlySet<string>,
  nextLineId: number,
): { lines: RoadLines; nextLineId: number } {
  const unassigned = [...roadCells].filter((key) => !lines[key] || lines[key]!.length === 0);
  if (unassigned.length === 0) return { lines, nextLineId };

  const parse = (key: string) => {
    const [x, y] = key.split(',').map(Number);
    return { x: x!, y: y! };
  };
  const has = (x: number, y: number) => roadCells.has(cellKey(x, y));

  let next = { ...lines };
  let id = nextLineId;
  const needsLine = new Set(unassigned);

  // Horizontal runs, then vertical runs. A run only becomes a line if it is at least
  // two cells long - a lone square is a station, not a line.
  for (const [alongX, alongY] of [
    [1, 0],
    [0, 1],
  ] as const) {
    const seen = new Set<string>();
    for (const key of roadCells) {
      if (seen.has(key)) continue;
      const cell = parse(key);
      // Only start at the beginning of a run.
      if (has(cell.x - alongX, cell.y - alongY)) continue;

      const run: Array<{ x: number; y: number }> = [];
      let cursor = cell;
      while (has(cursor.x, cursor.y)) {
        run.push(cursor);
        seen.add(cellKey(cursor.x, cursor.y));
        cursor = { x: cursor.x + alongX, y: cursor.y + alongY };
      }

      if (run.length < 2) continue;
      // Only claim a run that actually covers something still missing a line.
      if (!run.some((c) => needsLine.has(cellKey(c.x, c.y)))) continue;

      next = addLine(next, run, id);
      for (const c of run) needsLine.delete(cellKey(c.x, c.y));
      id += 1;
    }
  }

  // Anything still bare is an isolated square; give it its own id so it is never
  // mistaken for part of a neighbour's line.
  for (const key of needsLine) {
    next[key] = [id];
    id += 1;
  }

  return { lines: next, nextLineId: id };
}

/* ------------------------------------------------------------------ storage */

const storageKey = (cityId: string) => `rmc.roadLines.${cityId}`;

export function loadRoadLines(cityId: string): RoadLines {
  try {
    const raw = window.localStorage.getItem(storageKey(cityId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as RoadLines;
  } catch {
    // A blocked or corrupted store just means we re-derive from geometry.
    return {};
  }
}

export function saveRoadLines(cityId: string, lines: RoadLines): void {
  try {
    window.localStorage.setItem(storageKey(cityId), JSON.stringify(lines));
  } catch {
    // Non-fatal: the lines re-derive into straight runs next load.
  }
}
