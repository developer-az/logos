/** Display names for the platform's event types (services/docs/events.md). */
const LABELS: Record<string, string> = {
  'order.placed': 'Order placed',
  'order.confirmed': 'Order confirmed',
  'order.rejected': 'Order rejected',
  'order.cancelled': 'Order cancelled',
  'inventory.stock-reserved': 'Stock reserved',
  'inventory.stock-reservation-failed': 'Stock unavailable',
  'inventory.stock-released': 'Stock released',
  'inventory.stock-level-changed': 'Stock level changed',
};

export function eventLabel(eventType: string): string {
  return LABELS[eventType] ?? eventType;
}

/** The topic an event type is published to: order events by the order service, the rest by inventory. */
export function topicOf(eventType: string): 'orders' | 'inventory' {
  return eventType.startsWith('order.') ? 'orders' : 'inventory';
}

/** Order ids are GUIDs; the first block is enough to tell rows apart. */
export function shortId(id: string): string {
  return /^[0-9a-f]{8}-/i.test(id) ? id.slice(0, 8) : id;
}
