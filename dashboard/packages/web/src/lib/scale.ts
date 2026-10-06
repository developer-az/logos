/** Rounds a maximum up to a "nice" axis bound (1, 2, 2.5, 5 × 10^n) so ticks read cleanly. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (value <= m * base) return m * base;
  }
  return 10 * base;
}

export function linearScale(domainMax: number, rangeStart: number, rangeEnd: number) {
  return (v: number) => rangeStart + (v / domainMax) * (rangeEnd - rangeStart);
}

/** SVG path through points, as straight segments (no smoothing that would invent values). */
export function linePath(points: ReadonlyArray<readonly [number, number]>): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
}
