import { BoundedSet } from '../src/projection/bounded-set';
import { SampleWindow, latencyStats, percentile } from '../src/projection/stats';
import { CatchUpTracker } from '../src/kafka/catch-up';

describe('BoundedSet', () => {
  it('evicts the oldest entry past capacity', () => {
    const s = new BoundedSet<string>(2);
    expect(s.add('a')).toBe(true);
    expect(s.add('a')).toBe(false);
    s.add('b');
    s.add('c');
    expect([s.has('a'), s.has('b'), s.has('c'), s.size]).toEqual([false, true, true, 2]);
  });

  it.each([0, -1, 1.5])('rejects capacity %p', (c) => {
    expect(() => new BoundedSet(c)).toThrow(RangeError);
  });
});

describe('percentile (nearest rank)', () => {
  const xs = [15, 20, 35, 40, 50];

  it.each([
    [5, 15],
    [30, 20],
    [40, 20],
    [50, 35],
    [100, 50],
  ])('p%p of [15,20,35,40,50] is %p', (p, expected) => {
    expect(percentile(xs, p)).toBe(expected);
  });

  it('is null for no samples and rejects out-of-range p', () => {
    expect(percentile([], 50)).toBeNull();
    expect(() => percentile(xs, 0)).toThrow(RangeError);
    expect(() => percentile(xs, 101)).toThrow(RangeError);
  });

  it('always returns an observed sample', () => {
    const samples = Array.from({ length: 97 }, (_, i) => (i * 37) % 101);
    const sorted = [...samples].sort((a, b) => a - b);
    for (let p = 1; p <= 100; p++) expect(samples).toContain(percentile(sorted, p));
  });
});

describe('SampleWindow', () => {
  it('keeps only the last `capacity` samples', () => {
    const w = new SampleWindow(3);
    [1, 2, 3, 4, 5].forEach((x) => w.push(x));
    expect([...w.values()].sort()).toEqual([3, 4, 5]);
    expect(latencyStats(w.values())).toEqual({ samples: 3, p50Ms: 4, p95Ms: 5, maxMs: 5 });
  });

  it('summarizes an empty window as nulls', () => {
    expect(latencyStats([])).toEqual({ samples: 0, p50Ms: null, p95Ms: null, maxMs: null });
  });
});

describe('CatchUpTracker', () => {
  it('is caught up immediately when every partition is empty', () => {
    const t = new CatchUpTracker([
      { topic: 'o', partition: 0, low: '0', high: '0' },
      { topic: 'o', partition: 1, low: '12', high: '12' },
    ]);
    expect(t.caughtUp).toBe(true);
  });

  it('waits for the last offset of every non-empty partition', () => {
    const t = new CatchUpTracker([
      { topic: 'o', partition: 0, low: '0', high: '3' },
      { topic: 'i', partition: 0, low: '5', high: '6' },
    ]);
    t.markProcessed('o', 0, '1');
    expect(t.pendingPartitions).toBe(2);
    t.markProcessed('o', 0, '2');
    expect(t.pendingPartitions).toBe(1);
    t.markProcessed('i', 1, '99');
    expect(t.caughtUp).toBe(false);
    t.markProcessed('i', 0, '5');
    expect(t.caughtUp).toBe(true);
  });

  it('handles offsets beyond Number.MAX_SAFE_INTEGER', () => {
    const t = new CatchUpTracker([
      { topic: 'o', partition: 0, low: '0', high: '9007199254740995' },
    ]);
    t.markProcessed('o', 0, '9007199254740993');
    expect(t.caughtUp).toBe(false);
    t.markProcessed('o', 0, '9007199254740994');
    expect(t.caughtUp).toBe(true);
  });
});
