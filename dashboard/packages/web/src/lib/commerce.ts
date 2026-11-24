/**
 * The storefront's write side. The demo implements it on the in-browser pipeline; a live
 * deployment has no order API yet and must say so instead of pretending a checkout succeeded.
 */
export interface CatalogItem {
  sku: string;
  unitPrice: number;
  available: number;
}

export type PlaceOrderResult =
  | { ok: true; orderId: string }
  | { ok: false; error: string };

export interface CommerceActions {
  /** Set when the current data source cannot place orders. */
  unavailableReason?: string;
  catalog(): CatalogItem[];
  placeOrder(lines: Array<{ sku: string; quantity: number }>): PlaceOrderResult;
}

export const LIVE_ORDERING_UNAVAILABLE = 'Checkout is not available in live mode yet.';

export const unavailableActions: CommerceActions = {
  unavailableReason: LIVE_ORDERING_UNAVAILABLE,
  catalog: () => [],
  placeOrder: () => ({ ok: false, error: LIVE_ORDERING_UNAVAILABLE }),
};
