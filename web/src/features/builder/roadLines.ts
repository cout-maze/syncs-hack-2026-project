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
 * Traces whole corridors, not straight runs: a walk follows the road around its bends and
 * only stops where the road genuinely ends or forks. Splitting on bends instead would
 * make an L-shaped corridor two separate lines, and then deleting one end would take only
 * the straight piece you clicked rather than the path it belongs to.
 *
 * A fork square sits on every corridor that meets there, so all of them still draw
 * through it and deleting one leaves the others standing.
 */
export function assignMissingLines(
  lines: RoadLines,
  roadCells: ReadonlySet<string>,
  nextLineId: number,
): { lines: RoadLines; nextLineId: number } {
  const unassigned = new Set([...roadCells].filter((key) => !lines[key] || lines[key]!.length === 0));
  if (unassigned.size === 0) return { lines, nextLineId };

  const parse = (key: string) => {
    const [x, y] = key.split(',').map(Number);
    return { x: x!, y: y! };
  };

  // Only walk the part that still needs a line, so corridors already recorded (a road
  // the user drew) are left exactly as they are.
  const neighbours = (key: string): string[] => {
    const { x, y } = parse(key);
    return [
      cellKey(x + 1, y),
      cellKey(x - 1, y),
      cellKey(x, y + 1),
      cellKey(x, y - 1),
    ].filter((n) => unassigned.has(n));
  };

  let next = { ...lines };
  let id = nextLineId;

  const claim = (path: string[]) => {
    next = addLine(next, path.map(parse), id);
    id += 1;
  };

  const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const walked = new Set<string>();

  /** Follow the road from `from` into `into` until it ends or forks. */
  const traceFrom = (from: string, into: string) => {
    const path = [from];
    let previous = from;
    let cursor = into;
    for (;;) {
      walked.add(edgeKey(previous, cursor));
      path.push(cursor);
      const onward = neighbours(cursor);
      // A fork or a dead end closes the corridor.
      if (onward.length !== 2) break;
      const ahead = onward.find((n) => n !== previous);
      if (!ahead || walked.has(edgeKey(cursor, ahead))) break;
      previous = cursor;
      cursor = ahead;
    }
    claim(path);
  };

  // Every corridor has an end or a fork at each of its ends, so starting from those
  // covers all of them.
  for (const key of unassigned) {
    if (neighbours(key).length === 2) continue;
    for (const step of neighbours(key)) {
      if (walked.has(edgeKey(key, step))) continue;
      traceFrom(key, step);
    }
  }

  // A ring road has no end and no fork, so nothing above started on it.
  for (const key of unassigned) {
    if (next[key] && next[key]!.length > 0) continue;
    const first = neighbours(key)[0];
    if (!first) continue;
    const path = [key];
    let previous = key;
    let cursor: string | undefined = first;
    while (cursor && cursor !== key) {
      path.push(cursor);
      const onward: string[] = neighbours(cursor);
      const ahead: string | undefined = onward.find((n) => n !== previous);
      previous = cursor;
      cursor = ahead;
    }
    claim(path);
  }

  // Anything still bare is a lone square with no neighbours - a station, not a line.
  for (const key of unassigned) {
    if (next[key] && next[key]!.length > 0) continue;
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
