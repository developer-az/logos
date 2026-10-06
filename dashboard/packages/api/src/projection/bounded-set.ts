/**
 * Set with a fixed capacity that forgets its oldest entries first. Used to remember recently
 * seen event ids for idempotency without unbounded memory growth. The window only has to cover
 * the redelivery horizon (producer retries, consumer rebalances), not all history.
 */
export class BoundedSet<T> {
  private readonly items = new Set<T>();

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
    }
  }

  get size(): number {
    return this.items.size;
  }

  has(value: T): boolean {
    return this.items.has(value);
  }

  /** Adds `value`; returns false if it was already present. */
  add(value: T): boolean {
    if (this.items.has(value)) return false;
    this.items.add(value);
    if (this.items.size > this.capacity) {
      // Sets iterate in insertion order, so the first entry is the oldest.
      const oldest = this.items.values().next().value as T;
      this.items.delete(oldest);
    }
    return true;
  }
}
