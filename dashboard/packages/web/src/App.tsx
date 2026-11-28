import { useEffect, useState, useSyncExternalStore } from 'react';
import { ConnectionBadge } from './components/ConnectionBadge';
import type { DataMode, ModeStore } from './hooks/fallback-source';
import { navigateTo, useHashRoute } from './hooks/useHashRoute';
import { useLiveSnapshot, type EventSourceFactory } from './hooks/useLiveSnapshot';
import { cartCount, loadCart, saveCart, withQuantity, type Cart } from './lib/cart';
import { liveCatalogue } from './lib/catalogue';
import { unavailableActions, type CommerceActions } from './lib/commerce';
import { formatAgo } from './lib/format';
import { AboutPage } from './pages/AboutPage';
import { CartPage } from './pages/CartPage';
import { ControlTower } from './pages/ControlTower';
import { FinancePage } from './pages/FinancePage';
import { IncidentsPage } from './pages/IncidentsPage';
import { OrderPage } from './pages/OrderPage';
import { SourcingPage } from './pages/SourcingPage';
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
  const [catalogPrices, setCatalogPrices] = useState<Record<string, number>>({});
  const reported = useSyncExternalStore(
    (modeStore ?? ALWAYS_LIVE).subscribe,
    (modeStore ?? ALWAYS_LIVE).get,
  );
  const mode: DataMode = demo ? 'simulated' : reported;
  const fellBack = !!modeStore && reported === 'simulated';
  const commerce = actions ?? unavailableActions;
  const shopping =
    route.name === 'store' || route.name === 'cart' || route.name === 'sourcing';
  // Live: the services' SKUs priced from the page's table, availability from the read model.
  // Demo: the simulator owns its prices and its stock.
  const catalog = shopping
    ? mode === 'live'
      ? liveCatalogue(snapshot?.inventory.items ?? [], catalogPrices)
      : commerce.catalog()
    : [];
  const currency = snapshot?.currency ?? 'USD';
  const items = cartCount(cart);

  useEffect(() => saveCart(cart), [cart]);
  useEffect(() => {
    if (pendingOrderId && snapshot?.orders.recent.some((o) => o.orderId === pendingOrderId)) {
      setPendingOrderId(null);
    }
  }, [snapshot, pendingOrderId]);
  // The catalogue service owns the shelf prices; fetch them once in live mode for display.
  useEffect(() => {
    if (mode !== 'live' || !commerce.fetchCatalog) return;
    let cancelled = false;
    commerce.fetchCatalog()
      .then((products) => {
        if (cancelled || products.length === 0) return;
        setCatalogPrices(Object.fromEntries(products.map((p) => [p.sku, p.priceCents / 100])));
      })
      .catch(() => {
        // The table in lib/catalogue.ts is the fallback.
      });
    return () => {
      cancelled = true;
    };
  }, [mode, commerce]);

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
          <span className="brand-scope">Order platform over Kafka</span>
          <nav className="nav" aria-label="Sections">
            <a className="nav-link" href="#/" aria-current={route.name === 'store' ? 'page' : undefined}>
              Store
            </a>
            <a className="nav-link" href="#/sourcing" aria-current={route.name === 'sourcing' ? 'page' : undefined}>
              Sourcing
            </a>
            <a className="nav-link" href="#/finance" aria-current={route.name === 'finance' ? 'page' : undefined}>
              Finance
            </a>
            <a className="nav-link" href="#/incidents" aria-current={route.name === 'incidents' ? 'page' : undefined}>
              Incidents
            </a>
            <a className="nav-link" href="#/ops" aria-current={route.name === 'ops' ? 'page' : undefined}>
              Control tower
            </a>
            <a className="nav-link" href="#/about" aria-current={route.name === 'about' ? 'page' : undefined}>
              About
            </a>
          </nav>
          <div className="topbar-right">
            <ConnectionBadge connection={connection} caughtUp={snapshot?.caughtUp ?? null} />
            {receivedAt && <span className="freshness">Updated {formatAgo(receivedAt.toISOString(), now)}</span>}
            <a
              className="cart-pill"
              href="#/cart"
              aria-current={route.name === 'cart' ? 'page' : undefined}
            >
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M1.5 2h2l1.6 8.2a1 1 0 0 0 1 .8h6.3a1 1 0 0 0 1-.8L14.5 5H4"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="6.5" cy="13.5" r="1" fill="currentColor" />
                <circle cx="12" cy="13.5" r="1" fill="currentColor" />
              </svg>
              <span>
                Cart{items > 0 && <span key={items} className="cart-count"> ({items})</span>}
              </span>
            </a>
          </div>
        </div>
      </div>

      <main className="page" key={`${route.name}:${route.name === 'order' ? route.orderId : ''}`}>
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
        {route.name === 'sourcing' && (
          <SourcingPage
            snapshot={snapshot}
            catalog={catalog}
            now={now}
            currency={currency}
            actions={commerce}
          />
        )}
        {route.name === 'finance' && (
          <FinancePage snapshot={snapshot} now={now} currency={currency} />
        )}
        {route.name === 'incidents' && (
          <IncidentsPage snapshot={snapshot} actions={commerce} now={now} />
        )}
        {route.name === 'about' && <AboutPage />}
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
