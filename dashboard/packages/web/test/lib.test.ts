import { formatAgo, formatDuration, formatMoney, formatPercent } from '../src/lib/format';
import { linePath, niceMax } from '../src/lib/scale';

describe('format', () => {
  it.each([
    [null, '—'],
    [0, '$0.00'],
    [1_234_567, '$12,345.67'],
  ])('money %p -> %p', (cents, out) => expect(formatMoney(cents)).toBe(out));

  it('formats other currencies', () => expect(formatMoney(1050, 'EUR')).toBe('€10.50'));

  it.each([
    [null, '—'],
    [0, '0%'],
    [1, '100%'],
    [0.9091, '90.9%'],
  ])('percent %p -> %p', (r, out) => expect(formatPercent(r)).toBe(out));

  it.each([
    [null, '—'],
    [850.4, '850 ms'],
    [1_250, '1.3 s'],
    [150_000, '2.5 min'],
  ])('duration %p -> %p', (ms, out) => expect(formatDuration(ms)).toBe(out));

  it('formats relative time and clamps clock skew to "just now"', () => {
    const now = new Date('2026-10-06T10:00:00Z');
    expect(formatAgo('2026-10-06T10:00:03Z', now)).toBe('just now');
    expect(formatAgo('2026-10-06T09:59:18Z', now)).toBe('42 s ago');
    expect(formatAgo('2026-10-06T09:55:00Z', now)).toBe('5 min ago');
    expect(formatAgo('2026-10-06T07:00:00Z', now)).toBe('3 h ago');
    expect(formatAgo(null, now)).toBe('—');
  });
});

describe('scale', () => {
  it.each([
    [0, 1],
    [-3, 1],
    [1, 1],
    [7, 10],
    [18, 20],
    [21, 25],
    [41, 50],
    [101, 200],
    [0.3, 0.5],
  ])('niceMax(%p) = %p', (v, out) => expect(niceMax(v)).toBeCloseTo(out));

  it('never returns a bound below the value', () => {
    for (let v = 0.01; v < 1e6; v *= 1.37) expect(niceMax(v)).toBeGreaterThanOrEqual(v);
  });

  it('draws straight segments', () => {
    expect(linePath([[0, 10], [5.56, 2]])).toBe('M0.0,10.0L5.6,2.0');
    expect(linePath([])).toBe('');
  });
});
