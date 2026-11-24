import { parseEvent, type DashboardSnapshot } from '@orderflow/contracts';
import { Projection } from '../../../api/src/projection/projection';
import { OrderFlowSimulator, mulberry32, type Envelope } from '../../../api/src/simulator/generator';
import type { CommerceActions } from '../lib/commerce';
import type { EventSourceFactory, EventSourceLike } from '../hooks/useLiveSnapshot';

/**
 * Public demo mode: the whole pipeline runs in the visitor's browser, with no Kafka and no API.
 *
 * The API's own simulator produces the services' saga events, each one is serialized and parsed
 * back through the same contract validation the Kafka consumer uses, and the API's own projection
 * folds them into the snapshot the page renders. Only the transport is replaced: instead of
 * Kafka -> consumer -> SSE, events go straight from the generator to the read model, and the
 * snapshot is handed to the page through an EventSource lookalike.
 */
export interface DemoOptions {
  seed?: number;
  /** Mean orders per second (Poisson arrivals). */
  rate?: number;
  /** Minutes of history generated on load, so the charts aren't empty on first paint. */
  backfillMinutes?: number;
  /** Share of events delivered twice, as Kafka's at-least-once delivery would. */
  duplicateRate?: number;
  /** Share of events followed by a malformed message, to exercise the dead-letter path. */
  invalidRate?: number;
  tickMs?: number;
  /** How often a changed snapshot is pushed, like the API's STREAM_INTERVAL_MS. */
  pushMs?: number;
  now?: () => number;
}

export class DemoPipeline {
  readonly projection: Projection;
  private readonly sim: OrderFlowSimulator;
  private readonly rand: () => number;
  private readonly rate: number;
  private readonly duplicateRate: number;
  private readonly invalidRate: number;
  private readonly now: () => number;
  private nextOrderAt: number;
  private clock: number;

  constructor(opts: DemoOptions = {}) {
    const now = opts.now ?? Date.now;
    const seed = opts.seed ?? now() % 2 ** 31;
    this.now = now;
    this.rate = opts.rate ?? 1;
    this.duplicateRate = opts.duplicateRate ?? 0.02;
    this.invalidRate = opts.invalidRate ?? 0.001;
    this.rand = mulberry32(seed + 1);
    this.sim = new OrderFlowSimulator({ seed });
    this.projection = new Projection({ lowStockThreshold: 5, now: () => new Date(now()) });
    this.clock = now() - (opts.backfillMinutes ?? 60) * 60_000;
    this.deliver(this.sim.seedInventory(this.clock));
    this.nextOrderAt = this.clock;
  }

  /** Runs simulated time forward to `to`: order arrivals and every saga step due by then. */
  advanceTo(to: number): void {
    while (this.nextOrderAt <= to) {
      // Saga steps (reserve, confirm, cancel, restock) due before this order happen first.
      this.deliver(this.sim.due(this.nextOrderAt));
      this.deliver(this.sim.placeOrder(this.nextOrderAt));
      this.nextOrderAt += (-Math.log(1 - this.rand()) / this.rate) * 1000;
    }
    this.deliver(this.sim.due(to));
    this.clock = Math.max(this.clock, to);
  }

  snapshot(): DashboardSnapshot {
    return this.projection.snapshot(true);
  }

  /** The SKUs on sale, with the simulator's prices and the read model's availability. */
  catalog(): Array<{ sku: string; unitPrice: number; available: number }> {
    const prices = new Map(this.sim.catalog().map((s) => [s.sku, s.unitPrice]));
    return this.projection.listInventory().map((i) => ({
      sku: i.sku,
      unitPrice: prices.get(i.sku) ?? 0,
      available: i.available,
    }));
  }

  currentTime(): number {
    return this.now();
  }

  /**
   * Places a customer's order through the same simulator, contract validation and read model as
   * a simulated arrival. The decision is still the scheduled reservation, never an immediate one.
   */
  placeOrder(lines: Array<{ sku: string; quantity: number }>, at: number): string {
    if (lines.length === 0) throw new Error('The cart is empty');
    const known = new Set(this.sim.catalog().map((s) => s.sku));
    for (const line of lines) {
      if (!known.has(line.sku)) throw new Error(`Unknown SKU: ${line.sku}`);
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
        throw new Error('Quantity must be a positive integer');
      }
    }
    const { orderId, envelopes } = this.sim.placeOrderLines(at, lines);
    this.deliver(envelopes);
    return orderId;
  }

  private deliver(batch: Envelope[]): void {
    for (const { event } of batch) {
      const raw = JSON.stringify(event);
      this.consume(raw);
      if (this.rand() < this.duplicateRate) this.consume(raw);
      if (this.rand() < this.invalidRate) this.consume('{"eventType":"order.placed"');
    }
  }

  /** Same dispatch as the Kafka handler (packages/api/src/kafka/handler.ts), minus metrics. */
  private consume(raw: string): void {
    const parsed = parseEvent(raw);
    if (parsed.kind === 'event') this.projection.apply(parsed.event);
    else if (parsed.kind === 'unsupported') this.projection.recordUnsupported();
    else this.projection.recordInvalid();
  }
}

/** An EventSource that streams snapshots from an in-browser {@link DemoPipeline}. */
class DemoEventSource implements EventSourceLike {
  readyState = 0;
  onopen: ((ev: Event) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  private readonly listeners: Array<(ev: MessageEvent<string>) => void> = [];
  private readonly timers: Array<ReturnType<typeof setInterval>> = [];
  private sentVersion = -1;

  constructor(private readonly pipeline: DemoPipeline, opts: DemoOptions) {
    const now = opts.now ?? Date.now;
    this.timers.push(
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.(new Event('open'));
        this.push();
      }, 0),
      setInterval(() => this.pipeline.advanceTo(now()), opts.tickMs ?? 200),
      setInterval(() => this.push(), opts.pushMs ?? 500),
    );
  }

  addEventListener(type: string, listener: (ev: MessageEvent<string>) => void): void {
    if (type === 'snapshot') this.listeners.push(listener);
  }

  close(): void {
    this.readyState = 2;
    for (const t of this.timers) clearInterval(t);
  }

  private push(): void {
    if (this.readyState !== 1) return;
    // Coalesced like the API's SnapshotStream: nothing is sent while the state is unchanged.
    const version = this.pipeline.projection.version;
    if (version === this.sentVersion) return;
    this.sentVersion = version;
    const ev = new MessageEvent('snapshot', { data: JSON.stringify(this.pipeline.snapshot()) });
    for (const l of this.listeners) l(ev);
  }
}

export interface DemoRuntime {
  factory: EventSourceFactory;
  actions: CommerceActions;
}

/** One pipeline shared by the stream and the storefront, so both see the same state. */
export function createDemoRuntime(opts: DemoOptions = {}): DemoRuntime {
  let pipeline: DemoPipeline | undefined;
  const ensure = () => (pipeline ??= new DemoPipeline(opts));
  return {
    factory: (url) => {
      const p = ensure();
      p.advanceTo((opts.now ?? Date.now)());
      return new DemoEventSource(p, opts);
    },
    actions: {
      catalog: () => ensure().catalog(),
      placeOrder: (lines) => {
        try {
          const p = ensure();
          return { ok: true, orderId: p.placeOrder(lines, p.currentTime()) };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },
  };
}

export function createDemoEventSourceFactory(opts: DemoOptions = {}): EventSourceFactory {
  return createDemoRuntime(opts).factory;
}
