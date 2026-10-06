import type { DomainEvent } from '@orderflow/contracts';
import { Projection } from '../src/projection/projection';
import { OrderFlowSimulator } from '../src/simulator/generator';
import { T0_MS, at, cancelled, confirmed, ev, level, placed, rejected } from './fixtures';

const make = (overrides: Partial<ConstructorParameters<typeof Projection>[0]> = {}) =>
  new Projection({ lowStockThreshold: 5, now: () => new Date(T0_MS + 30_000), ...overrides });

describe('order saga', () => {
  it('tracks an order from placed to confirmed', () => {
    const p = make();
    p.apply(placed('ORD-1', 0, 25.5));
    p.apply(confirmed('ORD-1', 150));

    expect(p.getOrder('ORD-1')).toEqual({
      orderId: 'ORD-1',
      customerId: 'customer-1',
      status: 'confirmed',
      totalCents: 2550,
      itemCount: 2,
      placedAt: at(0),
      updatedAt: at(150),
      reason: null,
    });
    const s = p.snapshot(true);
    expect(s.orders.byStatus).toEqual({ placed: 0, confirmed: 1, rejected: 0, cancelled: 0 });
    expect(s.orders.revenueCents).toBe(2550);
    expect(s.currency).toBe('USD');
  });

  it('keeps status counts summing to the number of orders', () => {
    const p = make();
    for (const id of ['A', 'B', 'C', 'D']) p.apply(placed(id));
    p.apply(confirmed('A'));
    p.apply(rejected('B'));
    p.apply(cancelled('C'));
    const s = p.snapshot(true);
    expect(Object.values(s.orders.byStatus).reduce((a, b) => a + b, 0)).toBe(s.orders.total);
    expect(s.orders.byStatus).toEqual({ placed: 1, confirmed: 1, rejected: 1, cancelled: 1 });
  });

  it('computes acceptance over decided orders, unaffected by later cancellation', () => {
    const p = make();
    expect(p.snapshot(true).orders.acceptanceRate).toBeNull();
    for (const id of ['A', 'B', 'C', 'D', 'E', 'F']) p.apply(placed(id));
    p.apply(confirmed('A'));
    p.apply(confirmed('B'));
    p.apply(confirmed('C'));
    p.apply(cancelled('C'));
    p.apply(rejected('D'));
    // E is pending and F was cancelled before a decision: neither dilutes the rate.
    p.apply(cancelled('F'));
    expect(p.snapshot(true).orders.acceptanceRate).toBe(0.75);
  });

  it('records the reason of a rejection or cancellation', () => {
    const p = make();
    p.apply(placed('A'));
    p.apply(rejected('A'));
    p.apply(placed('B'));
    p.apply(ev('order.cancelled', { orderId: 'B', reason: null }));
    expect(p.getOrder('A')).toMatchObject({ status: 'rejected', reason: 'Insufficient stock' });
    expect(p.getOrder('B')).toMatchObject({ status: 'cancelled', reason: null });
  });

  it('takes revenue back out when a confirmed order is cancelled', () => {
    const p = make();
    p.apply(placed('A', 0, 40));
    p.apply(confirmed('A'));
    expect(p.snapshot(true).orders.revenueCents).toBe(4000);
    p.apply(cancelled('A'));
    expect(p.snapshot(true).orders.revenueCents).toBe(0);
  });

  it('sums decimal totals without float drift', () => {
    const p = make();
    for (let i = 0; i < 10; i++) {
      p.apply(placed(`O${i}`, 0, 0.1));
      p.apply(confirmed(`O${i}`));
    }
    expect(p.snapshot(true).orders.revenueCents).toBe(100);
  });
});

describe('at-least-once delivery', () => {
  it('ignores a redelivered event id', () => {
    const p = make();
    const e = placed('A', 0, 10);
    expect(p.apply(e)).toBe('applied');
    p.apply(confirmed('A'));
    expect(p.apply(e)).toBe('duplicate');
    expect(p.apply({ ...e })).toBe('duplicate');

    const s = p.snapshot(true);
    expect(s.orders.total).toBe(1);
    expect(s.orders.revenueCents).toBe(1000);
    expect(s.consumer).toMatchObject({ processed: 2, duplicates: 2 });
  });

  it('produces the same state when every event is delivered twice', () => {
    const events = simulatedStream(400);
    const once = make();
    const twice = make();
    for (const e of events) once.apply(e);
    for (const e of events) {
      twice.apply(e);
      twice.apply(e);
    }
    expect(withoutCounters(twice.snapshot(true))).toEqual(withoutCounters(once.snapshot(true)));
  });

  it('forgets ids beyond its dedupe capacity', () => {
    const p = make({ dedupeCapacity: 2 });
    const first = placed('A');
    p.apply(first);
    p.apply(placed('B'));
    p.apply(placed('C'));
    // `first` fell out of the window, so it is treated as new (and is idempotent anyway).
    expect(p.apply(first)).toBe('applied');
    expect(p.snapshot(true).orders.total).toBe(3);
  });
});

describe('out-of-order and late events', () => {
  it.each([
    ['cancelled', cancelled, [confirmed, rejected]],
    ['rejected', rejected, [confirmed, cancelled]],
  ] as const)('never moves an order out of %s', (_name, terminal, later) => {
    const p = make();
    p.apply(placed('A'));
    p.apply(terminal('A', 100));
    const before = p.getOrder('A')!.status;
    for (const e of later) p.apply(e('A', 200));
    expect(p.getOrder('A')!.status).toBe(before);
    expect(p.snapshot(true).consumer.ignoredTransitions).toBe(2);
  });

  it('does not reject an order that was already confirmed', () => {
    const p = make();
    p.apply(placed('A'));
    p.apply(confirmed('A'));
    p.apply(rejected('A'));
    expect(p.getOrder('A')!.status).toBe('confirmed');
  });

  it('tracks an order first seen through a later event, then fills it in', () => {
    const p = make();
    p.apply(confirmed('A', 400));
    expect(p.getOrder('A')).toMatchObject({ status: 'confirmed', totalCents: null, placedAt: null });
    expect(p.snapshot(true).orders.revenueCents).toBe(0);

    p.apply(placed('A', 100, 30));
    expect(p.getOrder('A')).toMatchObject({ status: 'confirmed', totalCents: 3000, placedAt: at(100) });
    expect(p.snapshot(true).orders.revenueCents).toBe(3000);
    expect(p.snapshot(true).decisionLatency).toMatchObject({ samples: 1, p50Ms: 300 });
  });

  it('does not move updatedAt backwards for a late event', () => {
    const p = make();
    p.apply(placed('A', 0));
    p.apply(confirmed('A', 1_000));
    p.apply(placed('A', 0));
    expect(p.getOrder('A')!.updatedAt).toBe(at(1_000));
  });

  it('compares timestamps correctly across UTC offsets', () => {
    const p = make();
    p.apply(placed('A', 0));
    // 11:00+02:00 is 09:00Z, earlier than placement at 10:00Z, so it must not win.
    p.apply({ ...confirmed('A'), occurredAt: '2026-10-06T11:00:00.000+02:00' });
    expect(p.getOrder('A')!.updatedAt).toBe(at(0));
  });
});

describe('decision latency', () => {
  it('measures placed to first decision with nearest-rank percentiles', () => {
    const p = make();
    for (let i = 1; i <= 20; i++) {
      p.apply(placed(`O${i}`, 0));
      p.apply(i % 2 ? confirmed(`O${i}`, i * 10) : rejected(`O${i}`, i * 10));
    }
    expect(p.snapshot(true).decisionLatency).toEqual({ samples: 20, p50Ms: 100, p95Ms: 190, maxMs: 200 });
  });

  it('drops negative samples caused by producer clock skew', () => {
    const p = make();
    p.apply(placed('A', 500));
    p.apply(confirmed('A', 100));
    expect(p.snapshot(true).decisionLatency.samples).toBe(0);
  });

  it('only uses the most recent samples', () => {
    const p = make({ latencyWindow: 3 });
    [1000, 10, 20, 30].forEach((ms, i) => {
      p.apply(placed(`O${i}`, 0));
      p.apply(confirmed(`O${i}`, ms));
    });
    expect(p.snapshot(true).decisionLatency).toMatchObject({ samples: 3, maxMs: 30 });
  });
});

describe('inventory', () => {
  it('takes stock from snapshots and flags low stock at the threshold', () => {
    const p = make();
    p.apply(level('SKU-1', 10, 4));
    p.apply(level('SKU-2', 10, 5));
    p.apply(level('SKU-3', 3, 3));

    const s = p.snapshot(true);
    expect(s.inventory.skus).toBe(3);
    expect(s.inventory.lowStock.map((i) => [i.sku, i.available])).toEqual([
      ['SKU-3', 0],
      ['SKU-2', 5],
    ]);
  });

  it('keeps the highest-version snapshot per SKU', () => {
    const p = make();
    p.apply(level('SKU-1', 10, 2, 0, 5));
    p.apply(level('SKU-1', 10, 9, 0, 4));
    p.apply(level('SKU-1', 10, 0, 0, 5));
    expect(p.listInventory()).toEqual([expect.objectContaining({ sku: 'SKU-1', reserved: 2, version: 5 })]);
    expect(p.snapshot(true).consumer.staleSnapshots).toBe(2);
    p.apply(level('SKU-1', 10, 9, 0, 6));
    expect(p.listInventory()[0]).toMatchObject({ available: 1, lowStock: true });
  });

  it('converges even if snapshots arrive in any order', () => {
    const events = simulatedStream(200);
    const inOrder = make();
    for (const e of events) inOrder.apply(e);
    const reversed = make();
    for (const e of [...events].reverse()) reversed.apply(e);
    const strip = (p: Projection) => p.listInventory().map(({ updatedAt: _u, ...rest }) => rest);
    expect(strip(reversed)).toEqual(strip(inOrder));
  });

  it('converges for any interleaving that keeps per-key order (what Kafka guarantees)', () => {
    const events = simulatedStream(300);
    const inOrder = make();
    for (const e of events) inOrder.apply(e);

    for (const seed of [1, 7, 42]) {
      const interleaved = make();
      for (const e of interleaveByKey(events, seed)) interleaved.apply(e);
      const strip = (p: Projection) => p.listInventory().map(({ updatedAt: _u, ...rest }) => rest);
      expect(strip(interleaved)).toEqual(strip(inOrder));
      expect(interleaved.snapshot(true).orders.byStatus).toEqual(inOrder.snapshot(true).orders.byStatus);
    }
  });

  it('treats reservation events as traffic only', () => {
    const p = make();
    p.apply(level('SKU-1', 1, 0));
    p.apply(ev('inventory.stock-reservation-failed', { orderId: 'A', reason: 'Insufficient stock', shortages: [{ sku: 'SKU-1', requested: 5, available: 1 }] }));
    p.apply(ev('inventory.stock-reserved', { orderId: 'B', lines: [{ sku: 'SKU-1', quantity: 1 }] }));
    p.apply(ev('inventory.stock-released', { orderId: 'B', lines: [{ sku: 'SKU-1', quantity: 1 }] }));
    expect(p.listInventory()[0]).toMatchObject({ onHand: 1, reserved: 0 });
    expect(p.snapshot(true).consumer.processed).toBe(4);
  });
});

describe('snapshot', () => {
  it('lists the most recently touched orders first, capped', () => {
    const p = make({ recentOrders: 2 });
    p.apply(placed('A'));
    p.apply(placed('B'));
    p.apply(placed('C'));
    p.apply(confirmed('A'));
    expect(p.snapshot(true).orders.recent.map((o) => o.orderId)).toEqual(['A', 'C']);
  });

  it('keeps a capped, newest-first event log keyed like the topics', () => {
    const p = make({ recentEvents: 2 });
    p.apply(placed('A'));
    p.apply(placed('B'));
    p.apply(level('SKU-9', 1, 0));
    expect(p.snapshot(true).recentEvents.map((e) => e.key)).toEqual(['SKU-9', 'B']);
  });

  it('buckets throughput per minute by event time and fills gaps with zeros', () => {
    const p = make({ throughputMinutes: 3, now: () => new Date(T0_MS + 2 * 60_000 + 5_000) });
    p.apply(placed('A', 0));
    p.apply(placed('B', 10_000));
    p.apply(level('SKU-1', 1, 0, 2 * 60_000));
    // Older than the window: not counted.
    p.apply(placed('OLD', -5 * 60_000));

    expect(p.snapshot(true).throughput).toEqual([
      { minute: at(0), orders: 2, inventory: 0 },
      { minute: at(60_000), orders: 0, inventory: 0 },
      { minute: at(120_000), orders: 0, inventory: 1 },
    ]);
  });

  it('slides the throughput window with the clock', () => {
    let now = T0_MS;
    const p = make({ throughputMinutes: 2, now: () => new Date(now) });
    p.apply(placed('A', 0));
    now += 5 * 60_000;
    expect(p.snapshot(true).throughput.every((b) => b.orders === 0)).toBe(true);
  });

  it('bumps the version on every visible change', () => {
    const p = make({ currency: 'EUR' });
    const v0 = p.version;
    p.apply(placed('A'));
    p.recordInvalid();
    p.recordUnsupported();
    expect(p.version).toBe(v0 + 3);
    expect(p.snapshot(false)).toMatchObject({ caughtUp: false, currency: 'EUR', consumer: { invalid: 1, unsupported: 1 } });
  });
});

it('matches the simulator’s own bookkeeping end to end', () => {
  const sim = new OrderFlowSimulator({ seed: 3 });
  const p = make();
  for (const e of sim.seedInventory(T0_MS)) p.apply(e.event);
  for (let i = 0; i < 200; i++) for (const e of sim.placeOrder(T0_MS + i * 50)) p.apply(e.event);
  for (const e of sim.due(Number.MAX_SAFE_INTEGER)) p.apply(e.event);

  const fromProjection = p.listInventory().map(({ sku, onHand, reserved, available, version }) => ({ sku, onHand, reserved, available, version }));
  expect(fromProjection).toEqual(sim.stockLevels());
  const s = p.snapshot(true);
  expect(s.orders.total).toBe(200);
  // Every order got a decision once the schedule drained.
  expect(s.orders.byStatus.placed).toBe(0);
  expect(s.orders.byStatus.rejected).toBeGreaterThan(0);
  expect(s.orders.byStatus.cancelled).toBeGreaterThan(0);
  expect(s.consumer.invalid + s.consumer.duplicates + s.consumer.ignoredTransitions + s.consumer.staleSnapshots).toBe(0);
});

function simulatedStream(orders: number): DomainEvent[] {
  const sim = new OrderFlowSimulator({ seed: 11 });
  const out = sim.seedInventory(T0_MS).map((e) => e.event);
  for (let i = 0; i < orders; i++) out.push(...sim.placeOrder(T0_MS + i * 20).map((e) => e.event));
  out.push(...sim.due(Number.MAX_SAFE_INTEGER).map((e) => e.event));
  return out;
}

/**
 * Random merge of per-key queues: each key's events stay in order (one partition), but keys
 * interleave arbitrarily, like a consumer reading several partitions and topics.
 */
function interleaveByKey(events: readonly DomainEvent[], seed: number): DomainEvent[] {
  const keyOf = (e: DomainEvent) =>
    e.eventType === 'inventory.stock-level-changed' ? `sku:${e.payload.sku}` : `${e.eventType.split('.')[0]}:${e.payload.orderId}`;
  const queues = new Map<string, DomainEvent[]>();
  for (const e of events) queues.set(keyOf(e), [...(queues.get(keyOf(e)) ?? []), e]);
  const live = [...queues.values()];
  const out: DomainEvent[] = [];
  let s = seed;
  while (live.length) {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    const i = s % live.length;
    out.push(live[i]!.shift()!);
    if (live[i]!.length === 0) live.splice(i, 1);
  }
  return out;
}

function withoutCounters<T extends { consumer: unknown; generatedAt: unknown }>(s: T) {
  const { consumer: _c, generatedAt: _g, ...rest } = s;
  return rest;
}
