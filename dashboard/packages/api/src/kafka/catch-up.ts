export interface PartitionRange {
  topic: string;
  partition: number;
  /** Earliest available offset (log start). */
  low: string;
  /** Next offset to be written (log end) at the time the target was captured. */
  high: string;
}

/**
 * Tracks whether the consumer has replayed every partition up to the end offsets captured at
 * startup. The read model lives in memory and is rebuilt by replay, so until this reports
 * caught up the dashboard would show partial numbers; readiness gates traffic on it.
 */
export class CatchUpTracker {
  private readonly pending = new Map<string, bigint>();

  constructor(ranges: readonly PartitionRange[]) {
    for (const r of ranges) {
      const high = BigInt(r.high);
      if (high > BigInt(r.low)) this.pending.set(keyOf(r.topic, r.partition), high);
    }
  }

  get caughtUp(): boolean {
    return this.pending.size === 0;
  }

  /** Number of partitions still being replayed. */
  get pendingPartitions(): number {
    return this.pending.size;
  }

  /** Call after a message at `offset` has been applied (or deliberately skipped). */
  markProcessed(topic: string, partition: number, offset: string): void {
    if (this.pending.size === 0) return;
    const key = keyOf(topic, partition);
    const high = this.pending.get(key);
    if (high !== undefined && BigInt(offset) + 1n >= high) this.pending.delete(key);
  }
}

function keyOf(topic: string, partition: number): string {
  return `${topic}:${partition}`;
}
