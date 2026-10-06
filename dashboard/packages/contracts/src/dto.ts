/**
 * Read-model shapes served by the API (REST and the live stream) and rendered by the web app.
 * These are the dashboard's own contract, independent of the Kafka wire format.
 */

export const ORDER_STATUSES = ['placed', 'confirmed', 'rejected', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface OrderView {
  orderId: string;
  customerId: string | null;
  status: OrderStatus;
  totalCents: number | null;
  itemCount: number | null;
  placedAt: string | null;
  updatedAt: string;
  /** Last rejection/cancellation reason, when there is one. */
  reason: string | null;
}

export interface InventoryView {
  sku: string;
  onHand: number;
  reserved: number;
  available: number;
  /** Per-SKU version of the snapshot shown; older snapshots are ignored. */
  version: number;
  updatedAt: string;
  lowStock: boolean;
}

export interface ThroughputPoint {
  /** Start of the one-minute bucket, ISO-8601 UTC. */
  minute: string;
  orders: number;
  inventory: number;
}

export interface LatencyStats {
  /** Number of samples in the window the percentiles are computed over. */
  samples: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export interface RecentEvent {
  eventId: string;
  eventType: string;
  occurredAt: string;
  key: string;
}

export interface ConsumerStats {
  processed: number;
  duplicates: number;
  invalid: number;
  /** Order events that would have moved an order out of a terminal state, and were ignored. */
  ignoredTransitions: number;
  /** Stock snapshots older than one already applied (by per-SKU version), ignored. */
  staleSnapshots: number;
  /** Well-formed events of a type or schema version this dashboard doesn't handle (skipped). */
  unsupported: number;
  lastEventAt: string | null;
}

export interface DashboardSnapshot {
  generatedAt: string;
  /** ISO 4217 code the money amounts are in (the events carry bare decimals). */
  currency: string;
  /** True once the consumer has caught up to the end of the topics it saw at startup. */
  caughtUp: boolean;
  orders: {
    total: number;
    byStatus: Record<OrderStatus, number>;
    /**
     * Orders whose stock reservation succeeded, divided by orders that got a decision
     * (confirmed or rejected). A later cancellation doesn't change the decision.
     */
    acceptanceRate: number | null;
    /** Sum of totals of orders currently confirmed (cancelled ones are taken back out). */
    revenueCents: number;
    recent: OrderView[];
  };
  /** Time from order.placed to the decision (confirmed or rejected). */
  decisionLatency: LatencyStats;
  inventory: {
    skus: number;
    lowStockThreshold: number;
    lowStock: InventoryView[];
  };
  throughput: ThroughputPoint[];
  recentEvents: RecentEvent[];
  consumer: ConsumerStats;
}
