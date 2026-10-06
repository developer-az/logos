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
  expect(TOPICS).toEqual({ orders: 'orders.events.v1', inventory: 'inventory.events.v1' });
  expect(deadLetterTopicFor(TOPICS.orders)).toBe('orders.events.v1.dlt');
});

it('knows exactly the eight event types in the contract', () => {
  expect([...EVENT_TYPES].sort()).toEqual([
    'inventory.stock-level-changed',
    'inventory.stock-released',
    'inventory.stock-reservation-failed',
    'inventory.stock-reserved',
    'order.cancelled',
    'order.confirmed',
    'order.placed',
    'order.rejected',
  ]);
});
