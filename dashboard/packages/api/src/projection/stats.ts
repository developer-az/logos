import type { LatencyStats } from '@orderflow/contracts';

/** Fixed-size ring buffer of numeric samples (the most recent `capacity` values). */
export class SampleWindow {
  private readonly buf: number[] = [];
  private next = 0;

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
    }
  }

  push(value: number): void {
    if (this.buf.length < this.capacity) {
      this.buf.push(value);
    } else {
      this.buf[this.next] = value;
    }
    this.next = (this.next + 1) % this.capacity;
  }

  values(): readonly number[] {
    return this.buf;
  }
}

/**
 * Nearest-rank percentile (p in (0, 100]) of an ascending-sorted array: the smallest value
 * such that at least p% of samples are <= it. Always returns an observed sample.
 */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (!(p > 0 && p <= 100)) throw new RangeError(`p must be in (0, 100], got ${p}`);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[rank - 1] ?? null;
}

export function latencyStats(samples: readonly number[]): LatencyStats {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    maxMs: sorted.length ? (sorted[sorted.length - 1] ?? null) : null,
  };
}
