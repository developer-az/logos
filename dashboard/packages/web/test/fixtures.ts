import type { DashboardSnapshot, ThroughputPoint } from '@orderflow/contracts';
import type { EventSourceLike } from '../src/hooks/useLiveSnapshot';

export function throughput(values: Array<[number, number]>): ThroughputPoint[] {
  const start = Date.parse('2026-10-06T10:00:00Z');
  return values.map(([orders, inventory], i) => ({
    minute: new Date(start + i * 60_000).toISOString(),
    orders,
    inventory,
  }));
}

export function snapshot(overrides: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return {
    generatedAt: '2026-10-06T10:05:00Z',
    currency: 'USD',
    caughtUp: true,
    orders: {
      total: 120,
      byStatus: { placed: 4, confirmed: 100, rejected: 10, cancelled: 6 },
      acceptanceRate: 100 / 110,
      revenueCents: 1_234_567,
      recent: [
        {
          orderId: '0b5a3c1e-7f00-4d1a-9a55-2a7bdf1f0c11',
          customerId: 'CUST-7',
          status: 'rejected',
          totalCents: 4599,
          itemCount: 3,
          placedAt: '2026-10-06T10:04:58Z',
          updatedAt: '2026-10-06T10:04:59Z',
          reason: 'Insufficient stock',
        },
      ],
    },
    decisionLatency: { samples: 110, p50Ms: 140, p95Ms: 1_250, maxMs: 2_400 },
    inventory: {
      skus: 12,
      lowStockThreshold: 5,
      lowStock: [
        { sku: 'SKU-0003', onHand: 4, reserved: 4, available: 0, version: 9, updatedAt: '2026-10-06T10:04:00Z', lowStock: true },
        { sku: 'SKU-0007', onHand: 10, reserved: 7, available: 3, version: 4, updatedAt: '2026-10-06T10:03:00Z', lowStock: true },
      ],
    },
    throughput: throughput([
      [10, 20],
      [12, 25],
      [30, 41],
      [5, 6],
    ]),
    recentEvents: [],
    consumer: { processed: 900, duplicates: 12, invalid: 1, ignoredTransitions: 0, staleSnapshots: 0, unsupported: 3, lastEventAt: '2026-10-06T10:04:59Z' },
    ...overrides,
  };
}

/** Test double for EventSource that the test drives by hand. */
export class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  readyState = 0;
  onopen: ((ev: Event) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  closed = false;
  private listeners = new Map<string, Array<(ev: MessageEvent<string>) => void>>();

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  static factory = (url: string) => new FakeEventSource(url);
  static latest(): FakeEventSource {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1]!;
  }

  addEventListener(type: string, listener: (ev: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
  emit(type: string, data: unknown) {
    const ev = new MessageEvent(type, { data: typeof data === 'string' ? data : JSON.stringify(data) });
    for (const l of this.listeners.get(type) ?? []) l(ev);
  }
  fail(permanently: boolean) {
    this.readyState = permanently ? 2 : 0;
    this.onerror?.(new Event('error'));
  }
}
