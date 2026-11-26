import {
  ORDER_STATUSES,
  partitionKeyOf,
  toCents,
  type DashboardSnapshot,
  type DeadLetter,
  type DomainEvent,
  type InventoryView,
  type LedgerEntry,
  type OrderStatus,
  type OrderView,
  type PurchaseOrderView,
  type RecentEvent,
  type SupplierQuote,
  type ThroughputPoint,
  type TimelineEntry,
} from '@orderflow/contracts';
import { BoundedSet } from './bounded-set';
import { latencyStats, SampleWindow } from './stats';

export interface ProjectionOptions {
  /** A SKU is low on stock when available (onHand - reserved) is at or below this. */
  lowStockThreshold: number;
  /** ISO 4217 code for display; the events carry bare decimal amounts. */
  currency?: string;
  /** How many event ids to remember for deduplication. */
  dedupeCapacity?: number;
  /** How many decision-latency samples the percentiles are computed over. */
  latencyWindow?: number;
  recentOrders?: number;
  recentEvents?: number;
  /** How many orders keep their saga timeline (most recently touched first). */
  timelineOrders?: number;
  /** Width of the throughput chart, in one-minute buckets ending at the current minute. */
  throughputMinutes?: number;
  now?: () => Date;
}

export type ApplyOutcome = 'applied' | 'duplicate';

const MINUTE_MS = 60_000;
const MAX_TIMELINE_STEPS = 12;
/** Allowed moves of the order saga: placed -> confirmed | rejected | cancelled, confirmed -> cancelled. */
const NEXT: Record<OrderStatus, ReadonlySet<OrderStatus>> = {
  placed: new Set(['confirmed', 'rejected', 'cancelled']),
  confirmed: new Set(['cancelled']),
  rejected: new Set(),
  cancelled: new Set(),
};

interface OrderState extends OrderView {
  decision: 'confirmed' | 'rejected' | null;
  decidedAt: string | null;
}

/**
 * In-memory read model built by folding order and inventory events.
 *
 * Correctness properties the tests pin down:
 * - Idempotent: re-applying an event id is a no-op (at-least-once delivery is safe).
 * - Orders only move along the saga (placed -> confirmed/rejected/cancelled, confirmed ->
 *   cancelled) and never leave a terminal state, so a replayed event can't resurrect an order.
 * - Inventory keeps the highest-version `inventory.stock-level-changed` snapshot per SKU, so
 *   replays and redeliveries of older snapshots can't roll stock back.
 * - Tolerates starting mid-stream: an order first seen via a later event is still tracked,
 *   and filled in if its order.placed arrives afterwards.
 */
export class Projection {
  private readonly opts: Required<ProjectionOptions>;
  private readonly seen: BoundedSet<string>;
  private readonly orders = new Map<string, OrderState>();
  /** Insertion-ordered: the most recently touched order id is last. */
  private readonly recentOrderIds = new Map<string, true>();
  private readonly byStatus: Record<OrderStatus, number>;
  private readonly inventory = new Map<string, InventoryView>();
  private readonly latency: SampleWindow;
  private readonly throughput = new Map<number, { orders: number; inventory: number }>();
  private readonly recent: RecentEvent[] = [];
  /** Saga timelines of the most recently touched orders; insertion-ordered, oldest first. */
  private readonly timelines = new Map<string, TimelineEntry[]>();
  private readonly quotes = new Map<string, SupplierQuote>();
  private readonly purchaseOrders = new Map<string, PurchaseOrderView>();
  private readonly ledger: LedgerEntry[] = [];
  private readonly deadLetters: DeadLetter[] = [];
  private capturedCents = 0;
  private refundedCents = 0;
  private cogsCapturedCents = 0;
  private cogsRefundedCents = 0;
  private revenueCents = 0;
  private accepted = 0;
  private rejected = 0;
  private counters = {
    processed: 0,
    duplicates: 0,
    invalid: 0,
    unsupported: 0,
    ignoredTransitions: 0,
    staleSnapshots: 0,
  };
  private lastEventAt: string | null = null;
  private _version = 0;

  constructor(options: ProjectionOptions) {
    this.opts = {
      currency: 'USD',
      dedupeCapacity: 100_000,
      latencyWindow: 1_000,
      recentOrders: 12,
      recentEvents: 50,
      timelineOrders: 500,
      throughputMinutes: 60,
      now: () => new Date(),
      ...options,
    };
    this.seen = new BoundedSet(this.opts.dedupeCapacity);
    this.latency = new SampleWindow(this.opts.latencyWindow);
    this.byStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<
      OrderStatus,
      number
    >;
  }

  /** Increments whenever the visible state changes; lets the stream skip unchanged pushes. */
  get version(): number {
    return this._version;
  }

  apply(event: DomainEvent): ApplyOutcome {
    if (!this.seen.add(event.eventId)) {
      this.counters.duplicates++;
      this._version++;
      return 'duplicate';
    }
    this.counters.processed++;
    // Normalize to UTC so timestamps with different offsets compare correctly as strings.
    const at = new Date(event.occurredAt).toISOString();
    this.lastEventAt = at;
    /** Set when this event is a step of an order's saga. */
    let stepOrderId: string | null = null;

    switch (event.eventType) {
      case 'order.placed': {
        const p = event.payload;
        const order = this.touchOrder(p.orderId, at);
        order.customerId = p.customerId;
        order.totalCents = toCents(p.total);
        order.itemCount = p.lines.reduce((n, l) => n + l.quantity, 0);
        order.placedAt = at;
        // The decision may have been seen first if we started mid-stream; count it now.
        if (order.decidedAt) this.recordLatency(order);
        if (order.status === 'confirmed') this.revenueCents += order.totalCents;
        stepOrderId = p.orderId;
        break;
      }
      case 'order.confirmed':
        this.transition(event.payload.orderId, 'confirmed', at, null);
        stepOrderId = event.payload.orderId;
        break;
      case 'order.rejected':
        this.transition(event.payload.orderId, 'rejected', at, event.payload.reason);
        stepOrderId = event.payload.orderId;
        break;
      case 'order.cancelled':
        this.transition(event.payload.orderId, 'cancelled', at, event.payload.reason ?? null);
        stepOrderId = event.payload.orderId;
        break;
      case 'inventory.stock-level-changed': {
        const s = event.payload;
        const current = this.inventory.get(s.sku);
        if (current && s.version <= current.version) {
          this.counters.staleSnapshots++;
          break;
        }
        this.inventory.set(s.sku, {
          sku: s.sku,
          onHand: s.onHand,
          reserved: s.reserved,
          available: s.available,
          version: s.version,
          updatedAt: at,
          lowStock: s.available <= this.opts.lowStockThreshold,
        });
        break;
      }
      case 'inventory.stock-reserved':
      case 'inventory.stock-reservation-failed':
      case 'inventory.stock-released':
        // Stock effects arrive as inventory.stock-level-changed; these only count as traffic.
        stepOrderId = event.payload.orderId;
        break;
      case 'procurement.quote-received': {
        const q = event.payload;
        this.quotes.set(`${q.sku}|${q.supplierId}`, {
          quoteId: q.quoteId,
          sku: q.sku,
          supplierId: q.supplierId,
          supplierName: q.supplierName,
          unitCostCents: q.unitCostCents,
          leadTimeDays: q.leadTimeDays,
          moq: q.moq,
          onTimeRate: q.onTimeRate,
          receivedAt: at,
        });
        break;
      }
      case 'procurement.purchase-order-placed': {
        const p = event.payload;
        this.purchaseOrders.set(p.purchaseOrderId, {
          purchaseOrderId: p.purchaseOrderId,
          sku: p.sku,
          supplierId: p.supplierId,
          supplierName: p.supplierName,
          quantity: p.quantity,
          unitCostCents: p.unitCostCents,
          totalCents: p.unitCostCents * p.quantity,
          leadTimeDays: p.leadTimeDays,
          placedAt: at,
          status: 'in-transit',
          receivedAt: null,
        });
        break;
      }
      case 'procurement.goods-received': {
        const p = event.payload;
        const po = this.purchaseOrders.get(p.purchaseOrderId);
        if (po) {
          po.status = 'received';
          po.receivedAt = at;
        }
        break;
      }
      case 'finance.payment-captured': {
        const p = event.payload;
        this.capturedCents += p.amountCents;
        this.cogsCapturedCents += p.costCents;
        this.pushLedger({ orderId: p.orderId, kind: 'capture', amountCents: p.amountCents, costCents: p.costCents, occurredAt: at });
        break;
      }
      case 'finance.refund-issued': {
        const p = event.payload;
        this.refundedCents += p.amountCents;
        this.cogsRefundedCents += p.costCents;
        this.pushLedger({ orderId: p.orderId, kind: 'refund', amountCents: p.amountCents, costCents: p.costCents, occurredAt: at });
        break;
      }
    }

    if (stepOrderId) this.recordStep(stepOrderId, event.eventType, at);
    this.countThroughput(event, at);
    this.recent.push({
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt: at,
      key: partitionKeyOf(event),
    });
    if (this.recent.length > this.opts.recentEvents) this.recent.shift();
    this._version++;
    return 'applied';
  }

  /** Records a message that failed contract validation (it is skipped, not applied). */
  recordInvalid(raw?: string, error?: string): void {
    this.counters.invalid++;
    if (raw !== undefined) {
      this.deadLetters.unshift({
        eventType: raw.match(/"eventType"\s*:\s*"([^"]+)"/)?.[1] ?? null,
        raw: raw.length > 400 ? `${raw.slice(0, 400)}…` : raw,
        error: error ?? 'invalid message',
        at: this.opts.now().toISOString(),
      });
      if (this.deadLetters.length > 5) this.deadLetters.pop();
    }
    this._version++;
  }

  /** Records a well-formed event of a type or version this dashboard doesn't handle. */
  recordUnsupported(): void {
    this.counters.unsupported++;
    this._version++;
  }

  getOrder(orderId: string): OrderView | undefined {
    const o = this.orders.get(orderId);
    return o ? this.withTimeline(o) : undefined;
  }

  listOrders(filter: { status?: OrderStatus; limit: number }): OrderView[] {
    const out: OrderView[] = [];
    for (const o of this.orders.values()) {
      if (!filter.status || o.status === filter.status) out.push(toOrderView(o));
    }
    out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return out.slice(0, filter.limit);
  }

  listInventory(): InventoryView[] {
    return [...this.inventory.values()].sort((a, b) => a.sku.localeCompare(b.sku));
  }

  snapshot(caughtUp: boolean): DashboardSnapshot {
    const decided = this.accepted + this.rejected;
    const recent: OrderView[] = [];
    for (const id of this.recentOrderIds.keys()) {
      const o = this.orders.get(id);
      if (o) recent.push(this.withTimeline(o));
    }
    recent.reverse();

    const lowStock = [...this.inventory.values()]
      .filter((i) => i.lowStock)
      .sort((a, b) => a.available - b.available || a.sku.localeCompare(b.sku));

    return {
      generatedAt: this.opts.now().toISOString(),
      currency: this.opts.currency,
      caughtUp,
      orders: {
        total: this.orders.size,
        byStatus: { ...this.byStatus },
        acceptanceRate: decided === 0 ? null : this.accepted / decided,
        revenueCents: this.revenueCents,
        recent,
      },
      decisionLatency: latencyStats(this.latency.values()),
      inventory: {
        skus: this.inventory.size,
        lowStockThreshold: this.opts.lowStockThreshold,
        lowStock,
      },
      procurement: {
        quotes: [...this.quotes.values()].sort(
          (a, b) => a.sku.localeCompare(b.sku) || a.unitCostCents - b.unitCostCents,
        ),
        purchaseOrders: [...this.purchaseOrders.values()]
          .sort((a, b) => b.placedAt.localeCompare(a.placedAt))
          .slice(0, 12),
      },
      finance: {
        capturedCents: this.capturedCents,
        refundedCents: this.refundedCents,
        cogsCents: this.cogsCapturedCents - this.cogsRefundedCents,
        marginCents:
          this.capturedCents - this.refundedCents - (this.cogsCapturedCents - this.cogsRefundedCents),
        reconciles:
          this.ledger.length === 0
            ? null
            : this.capturedCents - this.refundedCents === this.revenueCents,
        ledger: [...this.ledger],
      },
      deadLetters: [...this.deadLetters],
      throughput: this.throughputSeries(),
      recentEvents: [...this.recent].reverse(),
      consumer: { ...this.counters, lastEventAt: this.lastEventAt },
    };
  }

  private touchOrder(orderId: string, at: string): OrderState {
    let order = this.orders.get(orderId);
    if (!order) {
      order = {
        orderId,
        customerId: null,
        status: 'placed',
        totalCents: null,
        itemCount: null,
        placedAt: null,
        updatedAt: at,
        reason: null,
        decision: null,
        decidedAt: null,
      };
      this.orders.set(orderId, order);
      this.byStatus.placed++;
    } else if (at > order.updatedAt) {
      order.updatedAt = at;
    }
    this.recentOrderIds.delete(orderId);
    this.recentOrderIds.set(orderId, true);
    if (this.recentOrderIds.size > this.opts.recentOrders) {
      const oldest = this.recentOrderIds.keys().next().value as string;
      this.recentOrderIds.delete(oldest);
    }
    return order;
  }

  private transition(orderId: string, to: OrderStatus, at: string, reason: string | null): void {
    const order = this.touchOrder(orderId, at);
    const from = order.status;
    if (!NEXT[from].has(to)) {
      this.counters.ignoredTransitions++;
      return;
    }
    this.byStatus[from]--;
    this.byStatus[to]++;
    order.status = to;
    order.reason = reason;

    if (order.totalCents != null) {
      if (to === 'confirmed') this.revenueCents += order.totalCents;
      if (from === 'confirmed') this.revenueCents -= order.totalCents;
    }
    if ((to === 'confirmed' || to === 'rejected') && !order.decision) {
      order.decision = to;
      order.decidedAt = at;
      if (to === 'confirmed') this.accepted++;
      else this.rejected++;
      if (order.placedAt) this.recordLatency(order);
    }
  }

  /**
   * Adds one saga step to an order's timeline, in event-time order (the order and inventory
   * topics are consumed independently, so their events can interleave either way).
   */
  private recordStep(orderId: string, eventType: string, at: string): void {
    let steps = this.timelines.get(orderId);
    if (steps) {
      this.timelines.delete(orderId);
    } else {
      steps = [];
      if (this.timelines.size >= this.opts.timelineOrders) {
        this.timelines.delete(this.timelines.keys().next().value as string);
      }
    }
    this.timelines.set(orderId, steps);
    let i = steps.length;
    while (i > 0 && steps[i - 1]!.occurredAt > at) i--;
    steps.splice(i, 0, { eventType, occurredAt: at });
    // A saga has at most five steps; anything beyond that is a misbehaving producer.
    if (steps.length > MAX_TIMELINE_STEPS) steps.shift();
  }

  private withTimeline(o: OrderState): OrderView {
    const view = toOrderView(o);
    const steps = this.timelines.get(o.orderId);
    return steps ? { ...view, timeline: steps.map((s) => ({ ...s })) } : view;
  }

  private recordLatency(order: OrderState): void {
    const ms = Date.parse(order.decidedAt!) - Date.parse(order.placedAt!);
    // Negative means producer clock skew; it says nothing about real latency, so drop it.
    if (ms >= 0) this.latency.push(ms);
  }

  private countThroughput(event: DomainEvent, at: string): void {
    const minute = Math.floor(Date.parse(at) / MINUTE_MS) * MINUTE_MS;
    const oldestKept = this.currentMinute() - (this.opts.throughputMinutes - 1) * MINUTE_MS;
    if (minute < oldestKept) return;
    const bucket = this.throughput.get(minute) ?? { orders: 0, inventory: 0 };
    if (event.eventType.startsWith('order.')) bucket.orders++;
    else if (event.eventType.startsWith('inventory.')) bucket.inventory++;
    // Procurement and finance traffic is real but not part of this chart.
    else return;
    this.throughput.set(minute, bucket);
  }

  private pushLedger(entry: LedgerEntry): void {
    this.ledger.unshift(entry);
    if (this.ledger.length > 50) this.ledger.pop();
  }

  private throughputSeries(): ThroughputPoint[] {
    const end = this.currentMinute();
    const start = end - (this.opts.throughputMinutes - 1) * MINUTE_MS;
    for (const key of this.throughput.keys()) {
      if (key < start) this.throughput.delete(key);
    }
    const series: ThroughputPoint[] = [];
    for (let m = start; m <= end; m += MINUTE_MS) {
      const b = this.throughput.get(m);
      series.push({
        minute: new Date(m).toISOString(),
        orders: b?.orders ?? 0,
        inventory: b?.inventory ?? 0,
      });
    }
    return series;
  }

  private currentMinute(): number {
    return Math.floor(this.opts.now().getTime() / MINUTE_MS) * MINUTE_MS;
  }
}

function toOrderView(o: OrderState): OrderView {
  const { decision: _decision, decidedAt: _decidedAt, ...view } = o;
  return view;
}
