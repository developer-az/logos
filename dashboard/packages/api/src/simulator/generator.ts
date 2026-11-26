import {
  SCHEMA_VERSION,
  DEMO_LEAD_TIME_DAY_MS,
  partitionKeyOf,
  topicFor,
  type DomainEvent,
  type EventOf,
  type EventType,
  type OrderLine,
  type ReservedLine,
} from '@orderflow/contracts';

/**
 * Generates a realistic, internally consistent stream of order and inventory events, so the
 * dashboard can be demoed and load-tested without the C# services running.
 *
 * It follows the services' saga (services/docs/events.md): order.placed, then inventory
 * reserves every line or none; stock-reserved leads to order.confirmed and
 * stock-reservation-failed to order.rejected. Some confirmed orders are cancelled, releasing
 * their stock. Every stock change emits inventory.stock-level-changed for the SKU.
 * Fulfilment and restocking appear as manual stock updates (level changes with no order event),
 * as they would from the inventory service's stock API. Seeded, so tests are reproducible.
 */

export interface Envelope {
  topic: string;
  key: string;
  event: DomainEvent;
}

export interface SimulatorOptions {
  seed?: number;
  skus?: number;
  initialStock?: number;
  /** Fraction of confirmed orders later cancelled. */
  cancelRate?: number;
  /** Restock a SKU when its available stock falls to this level. */
  restockAt?: number;
  restockQuantity?: number;
}

interface Sku {
  sku: string;
  unitPrice: number;
  unitCostCents: number;
  onHand: number;
  reserved: number;
  version: number;
  restockPending: boolean;
  /** A purchase order is open, so the automatic restock stays out of the way. */
  poPending: boolean;
}

interface Supplier {
  supplierId: string;
  supplierName: string;
  /** Multiplier on the SKU's own cost basis. */
  costFactor: number;
  leadTimeDays: number;
  moq: number;
  onTimeRate: number;
}

/**
 * Three suppliers with a real trade-off: the cheapest is the slowest, the fastest is the
 * dearest, and MOQ decides how much cash a small restock ties up.
 */
export const SUPPLIERS: readonly Supplier[] = [
  {
    supplierId: 'northwind',
    supplierName: 'Northwind Supply',
    costFactor: 0.96,
    leadTimeDays: 3,
    moq: 6,
    onTimeRate: 0.97,
  },
  {
    supplierId: 'vertex',
    supplierName: 'Vertex Components',
    costFactor: 0.88,
    leadTimeDays: 6,
    moq: 12,
    onTimeRate: 0.91,
  },
  {
    supplierId: 'kiloparts',
    supplierName: 'Kilo Parts',
    costFactor: 1.04,
    leadTimeDays: 1,
    moq: 3,
    onTimeRate: 0.86,
  },
];

/** The demo compresses a day of lead time into a few seconds. */
const LEAD_TIME_DAY_MS = DEMO_LEAD_TIME_DAY_MS;

interface Scheduled {
  at: number;
  seq: number;
  run: (at: number) => Envelope[];
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class OrderFlowSimulator {
  private readonly rand: () => number;
  private readonly skus: Sku[];
  private readonly queue: Scheduled[] = [];
  private readonly opts: Required<Omit<SimulatorOptions, 'seed'>>;
  /** Quotes per `${sku}|${supplierId}`, resolved once so a PO charges exactly the quoted price. */
  private readonly quotes = new Map<string, { unitCostCents: number; leadTimeDays: number; moq: number }>();
  private readonly orderTotals = new Map<string, { totalCents: number; costCents: number }>();
  private seq = 0;

  constructor(options: SimulatorOptions = {}) {
    this.rand = mulberry32(options.seed ?? 42);
    this.opts = {
      skus: 12,
      initialStock: 40,
      cancelRate: 0.08,
      restockAt: 3,
      restockQuantity: 30,
      ...options,
    };
    this.skus = Array.from({ length: this.opts.skus }, (_, i) => {
      // Prices like 12.99: whole cents, as the services' decimal amounts are.
      const unitPrice = (500 + Math.floor(this.rand() * 9500)) / 100;
      return {
        sku: `SKU-${String(i + 1).padStart(4, '0')}`,
        unitPrice,
        // Goods cost 55-73% of the shelf price, which leaves a believable margin.
        unitCostCents: Math.round(unitPrice * 100 * (0.55 + this.rand() * 0.18)),
        onHand: this.opts.initialStock,
        reserved: 0,
        version: 0,
        restockPending: false,
        poPending: false,
      };
    });
    for (const s of this.skus) {
      for (const supplier of SUPPLIERS) {
        this.quotes.set(`${s.sku}|${supplier.supplierId}`, {
          unitCostCents: Math.round(s.unitCostCents * supplier.costFactor),
          leadTimeDays: supplier.leadTimeDays,
          moq: supplier.moq,
        });
      }
    }
  }

  /** Initial stock, one inventory.stock-level-changed per SKU. */
  seedInventory(at: number): Envelope[] {
    const correlationId = this.uuid();
    return this.skus.map((s) => this.levelChanged(s, at, correlationId, null));
  }

  /** One quote per SKU per supplier, as a procurement service would publish on startup. */
  seedQuotes(at: number): Envelope[] {
    const correlationId = this.uuid();
    const out: Envelope[] = [];
    for (const s of this.skus) {
      for (const supplier of SUPPLIERS) {
        const quote = this.quotes.get(`${s.sku}|${supplier.supplierId}`)!;
        out.push(
          this.event('procurement.quote-received', at, correlationId, null, {
            quoteId: `${s.sku}-${supplier.supplierId}`,
            sku: s.sku,
            supplierId: supplier.supplierId,
            supplierName: supplier.supplierName,
            unitCostCents: quote.unitCostCents,
            leadTimeDays: quote.leadTimeDays,
            moq: quote.moq,
            onTimeRate: supplier.onTimeRate,
          }),
        );
      }
    }
    return out;
  }

  /** Places a purchase order and schedules the goods receipt after the supplier's lead time. */
  placePurchaseOrder(
    at: number,
    sku: string,
    supplierId: string,
    quantity: number,
  ): { purchaseOrderId: string; envelopes: Envelope[] } {
    const s = this.skus.find((c) => c.sku === sku);
    if (!s) throw new Error(`Unknown SKU: ${sku}`);
    const supplier = SUPPLIERS.find((c) => c.supplierId === supplierId);
    if (!supplier) throw new Error(`Unknown supplier: ${supplierId}`);
    const quote = this.quotes.get(`${sku}|${supplierId}`)!;
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error('Quantity must be a positive integer');
    }
    if (quantity < quote.moq) {
      throw new Error(`${supplier.supplierName} has a minimum order of ${quote.moq}`);
    }

    const correlationId = this.uuid();
    const purchaseOrderId = this.uuid();
    const placed = this.event('procurement.purchase-order-placed', at, correlationId, null, {
      purchaseOrderId,
      sku,
      supplierId,
      supplierName: supplier.supplierName,
      quantity,
      unitCostCents: quote.unitCostCents,
      leadTimeDays: quote.leadTimeDays,
    });
    s.poPending = true;
    this.schedule(at + quote.leadTimeDays * LEAD_TIME_DAY_MS, (t) => {
      s.onHand += quantity;
      s.poPending = false;
      const received = this.event('procurement.goods-received', t, correlationId, placed.event.eventId, {
        purchaseOrderId,
        sku,
        quantity,
        unitCostCents: quote.unitCostCents,
      });
      return [received, this.levelChanged(s, t, correlationId, received.event.eventId)];
    });
    return { purchaseOrderId, envelopes: [placed] };
  }

  /** The catalogue the simulator sells from, with the prices its events carry. */
  catalog(): Array<{ sku: string; unitPrice: number }> {
    return this.skus.map((s) => ({ sku: s.sku, unitPrice: s.unitPrice }));
  }

  /** Places a new order now and schedules the rest of its saga. */
  placeOrder(at: number): Envelope[] {
    const lineCount = 1 + Math.floor(this.rand() * 3);
    const picked = new Map<Sku, number>();
    for (let i = 0; i < lineCount; i++) {
      const s = this.skus[Math.floor(this.rand() * this.skus.length)]!;
      picked.set(s, (picked.get(s) ?? 0) + 1 + Math.floor(this.rand() * 3));
    }
    return this.placePicked(at, picked);
  }

  /** Places an order for explicit lines, with the same reservation saga as a simulated order. */
  placeOrderLines(
    at: number,
    requested: Array<{ sku: string; quantity: number }>,
  ): { orderId: string; envelopes: Envelope[] } {
    const picked = new Map<Sku, number>();
    for (const line of requested) {
      const s = this.skus.find((c) => c.sku === line.sku);
      if (!s) throw new Error(`Unknown SKU: ${line.sku}`);
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
        throw new Error('Quantity must be a positive integer');
      }
      picked.set(s, (picked.get(s) ?? 0) + line.quantity);
    }
    const orderId = this.uuid();
    return { orderId, envelopes: this.placePicked(at, picked, orderId) };
  }

  private placePicked(at: number, picked: Map<Sku, number>, orderId = this.uuid()): Envelope[] {
    const correlationId = this.uuid();
    const lines: OrderLine[] = [...picked].map(([s, quantity]) => ({
      sku: s.sku,
      quantity,
      unitPrice: s.unitPrice,
    }));
    const totalCents = lines.reduce((t, l) => t + l.quantity * Math.round(l.unitPrice * 100), 0);
    const costCents = [...picked].reduce((t, [s, q]) => t + q * s.unitCostCents, 0);
    this.orderTotals.set(orderId, { totalCents, costCents });
    const placed = this.event('order.placed', at, correlationId, null, {
      orderId,
      customerId: `customer-${1 + Math.floor(this.rand() * 500)}`,
      lines,
      total: totalCents / 100,
    });
    // Reservation round trip: tens to hundreds of milliseconds, with a long tail.
    const decisionDelay = 20 + Math.floor(-Math.log(1 - this.rand()) * 120);
    this.schedule(at + decisionDelay, (t) =>
      this.reserve(orderId, picked, t, correlationId, placed.event.eventId),
    );
    return [placed];
  }

  /** Returns every scheduled event due at or before `now`, in time order. */
  due(now: number): Envelope[] {
    const out: Envelope[] = [];
    this.queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
    while (this.queue.length && this.queue[0]!.at <= now) {
      const job = this.queue.shift()!;
      out.push(...job.run(job.at));
    }
    return out;
  }

  /** Time of the next scheduled event, if any. */
  nextDueAt(): number | undefined {
    return this.queue.reduce<number | undefined>(
      (m, j) => (m === undefined || j.at < m ? j.at : m),
      undefined,
    );
  }

  stockLevels(): Array<{ sku: string; onHand: number; reserved: number; available: number; version: number }> {
    return this.skus.map((s) => ({
      sku: s.sku,
      onHand: s.onHand,
      reserved: s.reserved,
      available: s.onHand - s.reserved,
      version: s.version,
    }));
  }

  private reserve(
    orderId: string,
    picked: Map<Sku, number>,
    at: number,
    correlationId: string,
    causationId: string,
  ): Envelope[] {
    const lines: ReservedLine[] = [...picked].map(([s, quantity]) => ({ sku: s.sku, quantity }));
    const short = [...picked].filter(([s, q]) => s.onHand - s.reserved < q);
    if (short.length > 0) {
      const failed = this.event('inventory.stock-reservation-failed', at, correlationId, causationId, {
        orderId,
        reason: 'Insufficient stock',
        shortages: short.map(([s, q]) => ({
          sku: s.sku,
          requested: q,
          available: s.onHand - s.reserved,
        })),
      });
      return [
        failed,
        this.event('order.rejected', at + 5, correlationId, failed.event.eventId, {
          orderId,
          reason: 'Insufficient stock',
        }),
      ];
    }
    for (const [s, q] of picked) s.reserved += q;
    const reserved = this.event('inventory.stock-reserved', at, correlationId, causationId, {
      orderId,
      lines,
    });
    const confirmed = this.event('order.confirmed', at + 5, correlationId, reserved.event.eventId, {
      orderId,
    });
    const amounts = this.orderTotals.get(orderId) ?? { totalCents: 0, costCents: 0 };
    const captured = this.event('finance.payment-captured', at + 5, correlationId, confirmed.event.eventId, {
      orderId,
      amountCents: amounts.totalCents,
      costCents: amounts.costCents,
    });
    const out = [
      reserved,
      ...[...picked.keys()].map((s) => this.levelChanged(s, at, correlationId, reserved.event.eventId)),
      confirmed,
      captured,
    ];
    for (const s of picked.keys()) this.maybeScheduleRestock(s, at);
    if (this.rand() < this.opts.cancelRate) {
      this.schedule(at + 1_000 + Math.floor(this.rand() * 4_000), (t) =>
        this.cancel(orderId, picked, t, correlationId),
      );
    } else {
      this.schedule(at + 2_000 + Math.floor(this.rand() * 8_000), (t) =>
        this.fulfil(picked, t, correlationId),
      );
    }
    return out;
  }

  /** Shipping consumes the reservation: a manual stock update in the inventory service. */
  private fulfil(picked: Map<Sku, number>, at: number, correlationId: string): Envelope[] {
    return [...picked].map(([s, q]) => {
      s.onHand -= q;
      s.reserved -= q;
      return this.levelChanged(s, at, correlationId, null);
    });
  }

  private cancel(orderId: string, picked: Map<Sku, number>, at: number, correlationId: string): Envelope[] {
    const cancelled = this.event('order.cancelled', at, correlationId, null, {
      orderId,
      reason: 'Customer request',
    });
    for (const [s, q] of picked) s.reserved -= q;
    const released = this.event('inventory.stock-released', at + 5, correlationId, cancelled.event.eventId, {
      orderId,
      lines: [...picked].map(([s, quantity]) => ({ sku: s.sku, quantity })),
    });
    const amounts = this.orderTotals.get(orderId) ?? { totalCents: 0, costCents: 0 };
    const refunded = this.event('finance.refund-issued', at + 5, correlationId, cancelled.event.eventId, {
      orderId,
      amountCents: amounts.totalCents,
      costCents: amounts.costCents,
    });
    return [
      cancelled,
      released,
      ...[...picked.keys()].map((s) => this.levelChanged(s, at + 5, correlationId, released.event.eventId)),
      refunded,
    ];
  }

  private maybeScheduleRestock(s: Sku, at: number): void {
    // A purchase order in flight is the better restock: leave the level alone until it lands.
    if (s.poPending) return;
    if (s.restockPending || s.onHand - s.reserved > this.opts.restockAt) return;
    s.restockPending = true;
    this.schedule(at + 3_000 + Math.floor(this.rand() * 5_000), (t) => {
      s.onHand += this.opts.restockQuantity;
      s.restockPending = false;
      return [this.levelChanged(s, t, this.uuid(), null)];
    });
  }

  private levelChanged(s: Sku, at: number, correlationId: string, causationId: string | null): Envelope {
    s.version++;
    return this.event('inventory.stock-level-changed', at, correlationId, causationId, {
      sku: s.sku,
      onHand: s.onHand,
      reserved: s.reserved,
      available: s.onHand - s.reserved,
      version: s.version,
    });
  }

  private schedule(at: number, run: (at: number) => Envelope[]): void {
    this.queue.push({ at, seq: this.seq++, run });
  }

  private event<T extends EventType>(
    eventType: T,
    at: number,
    correlationId: string,
    causationId: string | null,
    payload: EventOf<T>['payload'],
  ): Envelope {
    const event = {
      eventId: this.uuid(),
      eventType,
      schemaVersion: SCHEMA_VERSION,
      correlationId,
      causationId,
      occurredAt: new Date(at).toISOString().replace('Z', '+00:00'),
      payload,
    } as DomainEvent;
    return {
      topic: topicFor(eventType),
      key: partitionKeyOf(event),
      event,
    };
  }

  /** RFC 4122 v4-shaped id from the seeded generator, so runs are reproducible. */
  private uuid(): string {
    const hex = Array.from({ length: 32 }, () => Math.floor(this.rand() * 16).toString(16));
    hex[12] = '4';
    hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
    const h = hex.join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
}
