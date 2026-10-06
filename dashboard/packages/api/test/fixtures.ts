import type { DomainEvent, EventOf, EventType } from '@orderflow/contracts';

let n = 0;
const T0 = Date.parse('2026-10-06T10:00:00.000Z');

/** ISO timestamp `ms` milliseconds after the fixed test epoch. */
export const at = (ms = 0) => new Date(T0 + ms).toISOString();
export const T0_MS = T0;

export function ev<T extends EventType>(
  eventType: T,
  payload: EventOf<T>['payload'],
  opts: { ms?: number; eventId?: string } = {},
): EventOf<T> {
  return {
    eventId: opts.eventId ?? `evt-${++n}`,
    eventType,
    schemaVersion: 1,
    correlationId: 'corr-1',
    causationId: null,
    occurredAt: at(opts.ms),
    payload,
  } as EventOf<T>;
}

export const placed = (orderId: string, ms = 0, total = 10): DomainEvent =>
  ev(
    'order.placed',
    { orderId, customerId: 'customer-1', lines: [{ sku: 'SKU-1', quantity: 2, unitPrice: total / 2 }], total },
    { ms },
  );

export const confirmed = (orderId: string, ms = 0) => ev('order.confirmed', { orderId }, { ms });
export const rejected = (orderId: string, ms = 0) =>
  ev('order.rejected', { orderId, reason: 'Insufficient stock' }, { ms });
export const cancelled = (orderId: string, ms = 0) =>
  ev('order.cancelled', { orderId, reason: 'Customer request' }, { ms });

const versions = new Map<string, number>();

/** A stock snapshot; `version` defaults to the next one for the SKU. */
export const level = (sku: string, onHand: number, reserved: number, ms = 0, version?: number) => {
  const v = version ?? (versions.get(sku) ?? 0) + 1;
  versions.set(sku, Math.max(v, versions.get(sku) ?? 0));
  return ev('inventory.stock-level-changed', { sku, onHand, reserved, available: onHand - reserved, version: v }, { ms });
};
