export type Cart = Record<string, number>;

const KEY = 'orderflow.cart.v1';
const MAX_QUANTITY = 10;

export function loadCart(): Cart {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const cart: Cart = {};
    for (const [sku, quantity] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof quantity === 'number' && Number.isInteger(quantity) && quantity > 0) {
        cart[sku] = Math.min(MAX_QUANTITY, quantity);
      }
    }
    return cart;
  } catch {
    return {};
  }
}

export function saveCart(cart: Cart): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(cart));
  } catch {
    // A blocked storage API only costs persistence, not the cart in this tab.
  }
}

export function cartCount(cart: Cart): number {
  return Object.values(cart).reduce((n, q) => n + q, 0);
}

export function withQuantity(cart: Cart, sku: string, quantity: number): Cart {
  const next = { ...cart };
  if (quantity <= 0) delete next[sku];
  else next[sku] = Math.min(MAX_QUANTITY, quantity);
  return next;
}
