import { z } from 'zod';

/**
 * Event contracts for the order and inventory topics, mirroring the C# services'
 * OrderPlatform.Contracts (see services/docs/events.md, the source of truth).
 *
 * Conventions that matter to this consumer:
 * - JSON, camelCase. Money is a decimal number in currency units (`unitPrice`, `total`).
 * - Message key: order id for every event, except `inventory.stock-level-changed`, which is
 *   keyed by SKU. So one order's events, and one SKU's stock snapshots, are each consumed in
 *   the order they were produced.
 * - Stock snapshots carry a per-SKU `version` that rises by one per change; keep the highest.
 *   That stays correct even if a snapshot is replayed or re-published out of order.
 * - Delivery is at-least-once; consumers dedupe on `eventId`.
 * - Consumers must ignore event types they don't know. A breaking payload change gets a new
 *   `schemaVersion`, so a known type with an unknown version is also skipped, not misread.
 * - Dead-lettered messages go to `<topic>.dlt` with `dlt-*` headers.
 */
export const TOPICS = {
  orders: 'orders.events.v1',
  inventory: 'inventory.events.v1',
  /** Dashboard-side extension: the C# services do not publish these yet (demo simulator does). */
  procurement: 'procurement.events.v1',
  finance: 'finance.events.v1',
} as const;

/** Which topic carries an event type, on the wire. */
export function topicFor(eventType: string): string {
  if (eventType.startsWith('order.')) return TOPICS.orders;
  if (eventType.startsWith('inventory.')) return TOPICS.inventory;
  if (eventType.startsWith('procurement.')) return TOPICS.procurement;
  return TOPICS.finance;
}

export const deadLetterTopicFor = (topic: string) => `${topic}.dlt`;

/** The demo compresses one supplier day of lead time into this many milliseconds. */
export const DEMO_LEAD_TIME_DAY_MS = 4_000;

export const SCHEMA_VERSION = 1;

const isoDateTime = z.iso.datetime({ offset: true });
const id = z.string().min(1).max(128);
const sku = z.string().min(1).max(64);
const quantity = z.number().int().positive();
const money = z.number().nonnegative().finite();
const stock = z.number().int().nonnegative();

export const OrderLineSchema = z.object({ sku, quantity, unitPrice: money });
export const ReservedLineSchema = z.object({ sku, quantity });
export const StockShortageSchema = z.object({ sku, requested: z.number().int(), available: z.number().int() });

const envelope = <T extends string, P extends z.ZodType>(eventType: T, payload: P) =>
  z.object({
    eventId: id,
    eventType: z.literal(eventType),
    schemaVersion: z.literal(SCHEMA_VERSION),
    correlationId: id,
    causationId: id.nullish(),
    occurredAt: isoDateTime,
    payload,
  });

export const OrderPlacedSchema = envelope(
  'order.placed',
  z.object({ orderId: id, customerId: id, lines: z.array(OrderLineSchema).min(1), total: money }),
);
export const OrderConfirmedSchema = envelope('order.confirmed', z.object({ orderId: id }));
export const OrderRejectedSchema = envelope('order.rejected', z.object({ orderId: id, reason: z.string() }));
export const OrderCancelledSchema = envelope(
  'order.cancelled',
  z.object({ orderId: id, reason: z.string().nullish() }),
);

export const StockReservedSchema = envelope(
  'inventory.stock-reserved',
  z.object({ orderId: id, lines: z.array(ReservedLineSchema).min(1) }),
);
export const StockReservationFailedSchema = envelope(
  'inventory.stock-reservation-failed',
  z.object({ orderId: id, reason: z.string(), shortages: z.array(StockShortageSchema) }),
);
export const StockReleasedSchema = envelope(
  'inventory.stock-released',
  z.object({ orderId: id, lines: z.array(ReservedLineSchema).min(1) }),
);
export const StockLevelChangedSchema = envelope(
  'inventory.stock-level-changed',
  z
    .object({
      sku,
      onHand: stock,
      reserved: stock,
      available: z.number().int(),
      version: z.number().int().nonnegative(),
    })
    .refine((s) => s.available === s.onHand - s.reserved, {
      message: 'available must equal onHand - reserved',
    }),
);

const cents = z.number().int().nonnegative();

/**
 * Procurement and finance are the dashboard's second and third bounded contexts. They use the
 * same envelope, dedupe and read-model rules as the order saga; only the C# services are absent,
 * so the demo simulator is their producer.
 */
export const ProcurementQuoteReceivedSchema = envelope(
  'procurement.quote-received',
  z.object({
    quoteId: id,
    sku,
    supplierId: id,
    supplierName: z.string().min(1).max(64),
    /** What the supplier charges for one unit, delivered. */
    unitCostCents: cents,
    leadTimeDays: z.number().int().positive().max(90),
    moq: z.number().int().positive(),
    /** Share of past deliveries that arrived on time, 0..1. */
    onTimeRate: z.number().min(0).max(1),
  }),
);

export const PurchaseOrderPlacedSchema = envelope(
  'procurement.purchase-order-placed',
  z.object({
    purchaseOrderId: id,
    sku,
    supplierId: id,
    supplierName: z.string().min(1).max(64),
    quantity,
    unitCostCents: cents,
    leadTimeDays: z.number().int().positive().max(90),
  }),
);

export const GoodsReceivedSchema = envelope(
  'procurement.goods-received',
  z.object({ purchaseOrderId: id, sku, quantity, unitCostCents: cents }),
);

export const PaymentCapturedSchema = envelope(
  'finance.payment-captured',
  z.object({
    orderId: id,
    amountCents: cents,
    /** Cost of the goods sold, recognised with the capture. */
    costCents: cents,
  }),
);

export const RefundIssuedSchema = envelope(
  'finance.refund-issued',
  z.object({ orderId: id, amountCents: cents, costCents: cents }),
);

const SCHEMAS = [
  OrderPlacedSchema,
  OrderConfirmedSchema,
  OrderRejectedSchema,
  OrderCancelledSchema,
  StockReservedSchema,
  StockReservationFailedSchema,
  StockReleasedSchema,
  StockLevelChangedSchema,
  ProcurementQuoteReceivedSchema,
  PurchaseOrderPlacedSchema,
  GoodsReceivedSchema,
  PaymentCapturedSchema,
  RefundIssuedSchema,
] as const;

export const DomainEventSchema = z.discriminatedUnion('eventType', SCHEMAS);

export type DomainEvent = z.infer<typeof DomainEventSchema>;
export type EventType = DomainEvent['eventType'];
export type EventOf<T extends EventType> = Extract<DomainEvent, { eventType: T }>;
export type OrderLine = z.infer<typeof OrderLineSchema>;
export type ReservedLine = z.infer<typeof ReservedLineSchema>;

export const EVENT_TYPES: readonly EventType[] = SCHEMAS.map((s) => s.shape.eventType.value);
const KNOWN = new Set<string>(EVENT_TYPES);

export type ParseResult =
  | { kind: 'event'; event: DomainEvent }
  /** Well-formed, but a type or schema version this consumer doesn't handle. Skip silently. */
  | { kind: 'unsupported'; eventType: string; schemaVersion: unknown }
  /** Not a valid event at all: dead-letter it. */
  | { kind: 'invalid'; error: string };

/** Parses a raw Kafka message value. Never throws. */
export function parseEvent(raw: Buffer | string | null | undefined): ParseResult {
  if (raw == null || raw.length === 0) return { kind: 'invalid', error: 'empty message value' };
  let json: unknown;
  try {
    json = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
  } catch (err) {
    return { kind: 'invalid', error: `invalid JSON: ${(err as Error).message}` };
  }
  if (json !== null && typeof json === 'object') {
    const { eventType, schemaVersion } = json as Record<string, unknown>;
    if (typeof eventType === 'string' && (!KNOWN.has(eventType) || schemaVersion !== SCHEMA_VERSION)) {
      return { kind: 'unsupported', eventType, schemaVersion };
    }
  }
  const result = DomainEventSchema.safeParse(json);
  if (!result.success) {
    return {
      kind: 'invalid',
      error: result.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; '),
    };
  }
  return { kind: 'event', event: result.data };
}

/** The Kafka message key the producer uses for an event. */
export function partitionKeyOf(event: DomainEvent): string {
  switch (event.eventType) {
    case 'inventory.stock-level-changed':
    case 'procurement.quote-received':
    case 'procurement.purchase-order-placed':
    case 'procurement.goods-received':
      // One SKU's quotes, orders and receipts stay in order.
      return event.payload.sku;
    default:
      return event.payload.orderId;
  }
}

/** Converts a decimal currency amount to integer cents without float drift (19.99 -> 1999). */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}
