import {
  DomainEventSchema,
  EVENT_TYPES,
  TOPICS,
  deadLetterTopicFor,
  parseEvent,
  partitionKeyOf,
  toCents,
} from '@orderflow/contracts';

// Shaped exactly like the example in services/docs/events.md (System.Text.Json output).
const placed = {
  eventId: '17f4d206-d3f5-45b6-bf12-cd387e0bd1ed',
  eventType: 'order.placed',
  schemaVersion: 1,
  correlationId: '8a95bc1d-459e-4f01-99a9-72ac582549d4',
  causationId: null,
  occurredAt: '2026-10-06T05:02:28.1+00:00',
  payload: {
    orderId: '0b5a3c1e-7f00-4d1a-9a55-2a7bdf1f0c11',
    customerId: 'customer-42',
    lines: [{ sku: 'SKU-1', quantity: 2, unitPrice: 12.5 }],
    total: 25.0,
  },
};

const levelChanged = {
  eventId: 'b1c3a2f0-0000-4000-8000-000000000001',
  eventType: 'inventory.stock-level-changed',
  schemaVersion: 1,
  correlationId: '8a95bc1d-459e-4f01-99a9-72ac582549d4',
  causationId: '17f4d206-d3f5-45b6-bf12-cd387e0bd1ed',
  occurredAt: '2026-10-06T07:02:28.1234567+02:00',
  payload: { sku: 'SKU-1', onHand: 10, reserved: 2, available: 8, version: 3 },
};

describe('parseEvent', () => {
  it('accepts the services’ wire format, including 1–7 digit fractions and offsets', () => {
    expect(parseEvent(Buffer.from(JSON.stringify(placed)))).toEqual({ kind: 'event', event: placed });
    expect(parseEvent(JSON.stringify(levelChanged)).kind).toBe('event');
  });

  it('accepts an omitted causationId and an omitted cancellation reason', () => {
    const cancelled = {
      ...placed,
      eventType: 'order.cancelled',
      payload: { orderId: placed.payload.orderId },
    };
    delete (cancelled as Partial<typeof cancelled>).causationId;
    expect(parseEvent(JSON.stringify(cancelled)).kind).toBe('event');
  });

  it.each([
    ['null value (tombstone)', null],
    ['empty value', Buffer.alloc(0)],
  ])('treats a %s as invalid', (_name, raw) => {
    expect(parseEvent(raw)).toEqual({ kind: 'invalid', error: 'empty message value' });
  });

  it('rejects malformed JSON without throwing', () => {
    const result = parseEvent('{"eventType":');
    expect(result.kind).toBe('invalid');
    expect(result.kind === 'invalid' && result.error).toMatch(/^invalid JSON/);
  });

  it('skips an unknown event type instead of failing on it, as the contract requires', () => {
    expect(parseEvent(JSON.stringify({ ...placed, eventType: 'order.shipped' }))).toEqual({
      kind: 'unsupported',
      eventType: 'order.shipped',
      schemaVersion: 1,
    });
  });

  it('skips a newer schema version rather than misreading it', () => {
    expect(parseEvent(JSON.stringify({ ...placed, schemaVersion: 2 })).kind).toBe('unsupported');
  });

  it('reports the path of every invalid field', () => {
    const bad = { ...placed, payload: { ...placed.payload, lines: [], total: -1 } };
    const result = parseEvent(JSON.stringify(bad));
    expect(result.kind).toBe('invalid');
    expect(result.kind === 'invalid' && result.error).toMatch(/payload\.lines/);
    expect(result.kind === 'invalid' && result.error).toMatch(/payload\.total/);
  });

  it.each([
    ['fractional quantity', { sku: 'SKU-1', quantity: 1.5, unitPrice: 1 }],
    ['zero quantity', { sku: 'SKU-1', quantity: 0, unitPrice: 1 }],
    ['negative price', { sku: 'SKU-1', quantity: 1, unitPrice: -0.01 }],
  ])('rejects an order line with a %s', (_name, line) => {
    const bad = { ...placed, payload: { ...placed.payload, lines: [line] } };
    expect(parseEvent(JSON.stringify(bad)).kind).toBe('invalid');
  });

  it('rejects a stock snapshot whose available is inconsistent', () => {
    const bad = { ...levelChanged, payload: { ...levelChanged.payload, available: 9 } };
    const result = parseEvent(JSON.stringify(bad));
    expect(result.kind === 'invalid' && result.error).toMatch(/available must equal onHand - reserved/);
  });

  it('rejects a timestamp without an offset and a missing correlationId', () => {
    expect(parseEvent(JSON.stringify({ ...placed, occurredAt: '2026-10-06T10:00:00' })).kind).toBe('invalid');
    const { correlationId: _c, ...noCorrelation } = placed;
    expect(parseEvent(JSON.stringify(noCorrelation)).kind).toBe('invalid');
  });
});

it('requires a stock snapshot version', () => {
  const { version: _v, ...noVersion } = levelChanged.payload;
  expect(parseEvent(JSON.stringify({ ...levelChanged, payload: noVersion })).kind).toBe('invalid');
});

describe('partitionKeyOf', () => {
  it('keys by order id, and stock snapshots by SKU', () => {
    expect(partitionKeyOf(DomainEventSchema.parse(placed))).toBe(placed.payload.orderId);
    expect(partitionKeyOf(DomainEventSchema.parse(levelChanged))).toBe('SKU-1');
  });

  it('keys procurement events by SKU and money by order id', () => {
    const quote = {
      ...placed,
      eventType: 'procurement.quote-received',
      payload: {
        quoteId: 'q-1',
        sku: 'SKU-1',
        supplierId: 'northwind',
        supplierName: 'Northwind Supply',
        unitCostCents: 900,
        leadTimeDays: 3,
        moq: 6,
        onTimeRate: 0.97,
      },
    };
    const payment = {
      ...placed,
      eventType: 'finance.payment-captured',
      payload: { orderId: 'ORD-1', amountCents: 2500, costCents: 1600 },
    };
    expect(partitionKeyOf(DomainEventSchema.parse(quote))).toBe('SKU-1');
    expect(partitionKeyOf(DomainEventSchema.parse(payment))).toBe('ORD-1');
  });
});

describe('procurement events', () => {
  // Shaped like Procurement.Service's records after System.Text.Json (camelCase, Guid strings).
  const quote = {
    eventId: 'c3a1f2e0-1111-4a2b-8c3d-4e5f60718293',
    eventType: 'procurement.quote-received',
    schemaVersion: 1,
    correlationId: '8a95bc1d-459e-4f01-99a9-72ac582549d4',
    causationId: null,
    occurredAt: '2026-11-26T12:00:00+00:00',
    payload: {
      quoteId: 'd4b2e3f1-2222-4b3c-9d4e-5f6071829304',
      sku: 'WEBCAM-HD',
      supplierId: 'kiloparts',
      supplierName: 'Kilo Parts',
      unitCostCents: 5616,
      leadTimeDays: 1,
      moq: 3,
      onTimeRate: 0.86,
    },
  };

  it('parses a quote, a purchase order and a goods receipt from the service', () => {
    const order = {
      ...quote,
      eventType: 'procurement.purchase-order-placed',
      payload: {
        purchaseOrderId: 'e5c3f4a2-3333-4c4d-ae5f-607182930415',
        sku: 'WEBCAM-HD',
        supplierId: 'kiloparts',
        supplierName: 'Kilo Parts',
        quantity: 12,
        unitCostCents: 5616,
        leadTimeDays: 1,
      },
    };
    const receipt = {
      ...quote,
      eventType: 'procurement.goods-received',
      payload: {
        purchaseOrderId: 'e5c3f4a2-3333-4c4d-ae5f-607182930415',
        sku: 'WEBCAM-HD',
        quantity: 12,
        unitCostCents: 5616,
      },
    };

    expect(parseEvent(JSON.stringify(quote)).kind).toBe('event');
    expect(parseEvent(JSON.stringify(order)).kind).toBe('event');
    expect(parseEvent(JSON.stringify(receipt)).kind).toBe('event');
  });

  it('rejects a quote whose lead time is zero', () => {
    const bad = { ...quote, payload: { ...quote.payload, leadTimeDays: 0 } };
    expect(parseEvent(JSON.stringify(bad)).kind).toBe('invalid');
  });
});

describe('toCents', () => {
  it.each([
    [0, 0],
    [19.99, 1999],
    [0.1 + 0.2, 30],
    [1234567.89, 123456789],
  ])('%p -> %p', (amount, cents) => expect(toCents(amount)).toBe(cents));
});

it('names topics and dead-letter topics like the services do', () => {
  expect(TOPICS).toEqual({
    orders: 'orders.events.v1',
    inventory: 'inventory.events.v1',
    procurement: 'procurement.events.v1',
    finance: 'finance.events.v1',
  });
  expect(deadLetterTopicFor(TOPICS.orders)).toBe('orders.events.v1.dlt');
});

it('knows every event type in the contract', () => {
  expect([...EVENT_TYPES].sort()).toEqual([
    'finance.payment-captured',
    'finance.refund-issued',
    'inventory.stock-level-changed',
    'inventory.stock-released',
    'inventory.stock-reservation-failed',
    'inventory.stock-reserved',
    'order.cancelled',
    'order.confirmed',
    'order.placed',
    'order.rejected',
    'procurement.goods-received',
    'procurement.purchase-order-placed',
    'procurement.quote-received',
  ]);
});
