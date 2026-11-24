import { useEffect, useState, useSyncExternalStore } from 'react';
import { ConnectionBadge } from './components/ConnectionBadge';
import type { DataMode, ModeStore } from './hooks/fallback-source';
import { navigateTo, useHashRoute } from './hooks/useHashRoute';
import { useLiveSnapshot, type EventSourceFactory } from './hooks/useLiveSnapshot';
import { cartCount, loadCart, saveCart, withQuantity, type Cart } from './lib/cart';
import { unavailableActions, type CommerceActions } from './lib/commerce';
import { formatAgo } from './lib/format';
import { CartPage } from './pages/CartPage';
import { ControlTower } from './pages/ControlTower';
import { OrderPage } from './pages/OrderPage';
import { StorePage } from './pages/StorePage';

export function App({
  streamUrl,
  createEventSource,
  demo = false,
  mode: modeStore,
  actions,
}: {
  streamUrl?: string;
  createEventSource?: EventSourceFactory;
  /** Public demo: events are simulated in the browser rather than read from Kafka. */
  demo?: boolean;
  /** Public build with a live backend: reports whether it is live or fell back to simulation. */
  mode?: ModeStore;
  /** The storefront's write side; absent means this deployment cannot place orders. */
  actions?: CommerceActions;
}) {
  const { snapshot, connection, receivedAt } = useLiveSnapshot(streamUrl, createEventSource);
  const now = useNow(5_000);
  const route = useHashRoute();
  const [cart, setCart] = useState<Cart>(loadCart);
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const reported = useSyncExternalStore(
    (modeStore ?? ALWAYS_LIVE).subscribe,
    (modeStore ?? ALWAYS_LIVE).get,
  );
  const mode: DataMode = demo ? 'simulated' : reported;
  const fellBack = !!modeStore && reported === 'simulated';
  const commerce = actions ?? unavailableActions;
  const shopping = route.name === 'store' || route.name === 'cart';
  const catalog = shopping ? commerce.catalog() : [];
  const currency = snapshot?.currency ?? 'USD';
  const items = cartCount(cart);

  useEffect(() => saveCart(cart), [cart]);
  useEffect(() => {
    if (pendingOrderId && snapshot?.orders.recent.some((o) => o.orderId === pendingOrderId)) {
      setPendingOrderId(null);
    }
  }, [snapshot, pendingOrderId]);

  const addToCart = (sku: string, quantity: number) =>
    setCart((current) => withQuantity(current, sku, (current[sku] ?? 0) + quantity));

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="https://github.com/developer-az/logos">
            <BrandMark />
            <span>Orderflow</span>
          </a>
          <span className="brand-scope">Order &amp; inventory events</span>
          <nav className="nav" aria-label="Sections">
            <a className="nav-link" href="#/" aria-current={route.name === 'store' ? 'page' : undefined}>
              Store
            </a>
            <a className="nav-link" href="#/cart" aria-current={route.name === 'cart' ? 'page' : undefined}>
              Cart{items > 0 ? ` (${items})` : ''}
            </a>
            <a className="nav-link" href="#/ops" aria-current={route.name === 'ops' ? 'page' : undefined}>
              Control tower
            </a>
          </nav>
          <div className="topbar-right">
            <ConnectionBadge connection={connection} caughtUp={snapshot?.caughtUp ?? null} />
            {receivedAt && <span className="freshness">Updated {formatAgo(receivedAt.toISOString(), now)}</span>}
          </div>
        </div>
      </div>

      <main className="page">
        {route.name === 'ops' && (
          <ControlTower
            snapshot={snapshot}
            now={now}
            mode={mode}
            fellBack={fellBack}
            demo={demo}
            live={!!modeStore && reported === 'live'}
          />
        )}
        {route.name === 'store' && (
          <StorePage
            catalog={catalog}
            currency={currency}
            cart={cart}
            unavailableReason={commerce.unavailableReason}
            onAdd={addToCart}
          />
        )}
        {route.name === 'cart' && (
          <CartPage
            cart={cart}
            catalog={catalog}
            currency={currency}
            actions={commerce}
            onChangeQuantity={(sku, quantity) => setCart((current) => withQuantity(current, sku, quantity))}
            onAdd={addToCart}
            onOrderPlaced={(orderId) => {
              setCart({});
              setPendingOrderId(orderId);
              navigateTo(`#/orders/${orderId}`);
            }}
          />
        )}
        {route.name === 'order' && (
          <OrderPage
            orderId={route.orderId}
            snapshot={snapshot}
            now={now}
            currency={currency}
            pending={pendingOrderId === route.orderId}
          />
        )}
      </main>
    </div>
  );
}

/** The product's mark: the two topics, the hand-off between services, one read model. */
function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M1.5 7h21M1.5 17h21" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="6.5" cy="7" r="2.6" fill="var(--orders)" />
      <circle cx="17.5" cy="17" r="2.6" fill="var(--inventory)" />
      <path d="M6.5 9.6v4.8h11" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

const ALWAYS_LIVE: ModeStore = { get: () => 'live', subscribe: () => () => {} };

function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
