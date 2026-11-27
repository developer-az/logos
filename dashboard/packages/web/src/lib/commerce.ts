/**
 * The product's write side. The demo implements it on the in-browser pipeline; a live
 * deployment has no write API yet and must say so instead of pretending an action succeeded.
 */
export interface CatalogItem {
  sku: string;
  unitPrice: number;
  available: number;
}

export type PlaceOrderResult =
  | { ok: true; orderId: string }
  | { ok: false; error: string };

/** A write that does not hand back an id the page has to follow. */
export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

/** The demo writes synchronously; a live write goes over the network. Pages await either. */
export type MaybePromise<T> = T | Promise<T>;

export interface CommerceActions {
  /** Set when the current data source cannot write at all. */
  unavailableReason?: string;
  catalog(): CatalogItem[];
  placeOrder(lines: Array<{ sku: string; quantity: number }>): MaybePromise<PlaceOrderResult>;
  /** Raises a purchase order; the goods receipt follows after the supplier's lead time. */
  placePurchaseOrder(sku: string, supplierId: string, quantity: number): MaybePromise<ActionResult>;
  /** Incidents lab: republish the last applied event, which the consumer must ignore. */
  sendDuplicate(): MaybePromise<ActionResult>;
  /** Incidents lab: publish a truncated message, which the consumer must dead-letter. */
  sendMalformed(): MaybePromise<ActionResult>;
  /** Incidents lab: publish the last dead-lettered body again. */
  replayDeadLetter(): MaybePromise<ActionResult>;
}

export const LIVE_WRITES_UNAVAILABLE = 'This build has no write path configured.';

export const unavailableActions: CommerceActions = {
  unavailableReason: LIVE_WRITES_UNAVAILABLE,
  catalog: () => [],
  placeOrder: () => ({ ok: false, error: LIVE_WRITES_UNAVAILABLE }),
  placePurchaseOrder: () => ({ ok: false, error: LIVE_WRITES_UNAVAILABLE }),
  sendDuplicate: () => ({ ok: false, error: LIVE_WRITES_UNAVAILABLE }),
  sendMalformed: () => ({ ok: false, error: LIVE_WRITES_UNAVAILABLE }),
  replayDeadLetter: () => ({ ok: false, error: LIVE_WRITES_UNAVAILABLE }),
};
