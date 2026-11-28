import { useEffect, useState } from 'react';
import type { DashboardSnapshot, OrderView } from '@orderflow/contracts';
import { SagaSpotlight } from '../components/SagaSpotlight';
import { formatAgo, formatMoney } from '../lib/format';

const STATUS_TEXT = {
  placed: 'Awaiting decision',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
} as const;

export function OrderPage({
  orderId,
  snapshot,
  now,
  currency,
  pending = false,
}: {
  orderId: string;
  snapshot: DashboardSnapshot | null;
  now: Date;
  currency: string;
  /** The order was just placed, so its absence means the next snapshot hasn't arrived yet. */
  pending?: boolean;
}) {
  const liveOrder = snapshot?.orders.recent.find((o) => o.orderId === orderId);
  // The snapshot only carries the most recent orders. Keep the last state we saw for this one,
  // so an order placed a minute ago does not turn into "unknown" while the visitor is reading it.
  const [remembered, setRemembered] = useState<OrderView | null>(null);
  useEffect(() => {
    if (liveOrder) setRemembered(liveOrder);
    else setRemembered((previous) => (previous?.orderId === orderId ? previous : null));
  }, [liveOrder, orderId]);

  const order = liveOrder ?? (remembered?.orderId === orderId ? remembered : undefined);
  const leftWindow = !liveOrder && !!order;

  return (
    <>
      <header className="masthead">
        <div className="masthead-main">
          <p className="eyebrow">
            <span className="eyebrow-index">07</span>
            Order trace
          </p>
          <h1>Order</h1>
          <p className="sub mono">{orderId}</p>
        </div>
        <a className="quiet-button" href="#/">
          Back to store
        </a>
      </header>

      {!snapshot ? (
        <p className="empty" role="status">
          Waiting for the first update…
        </p>
      ) : order ? (
        <div className="workbench workbench-top">
          <SagaSpotlight order={order} now={now} currency={currency} span="span-8" />
          <section className="card span-4" aria-labelledby="facts-title">
            <h2 id="facts-title">Order record</h2>
            <p className="card-hint">The read model's current view of this order.</p>
            <dl className="facts">
              <dt>Status</dt>
              <dd>
                <span className={`pill pill-${order.status}`}>{STATUS_TEXT[order.status]}</span>
              </dd>
              <dt>Total</dt>
              <dd>{formatMoney(order.totalCents, currency)}</dd>
              <dt>Items</dt>
              <dd>{order.itemCount ?? '—'}</dd>
              <dt>Placed</dt>
              <dd>{order.placedAt ? formatAgo(order.placedAt, now) : '—'}</dd>
              <dt>Updated</dt>
              <dd>
                <time dateTime={order.updatedAt}>{formatAgo(order.updatedAt, now)}</time>
              </dd>
              {order.reason && (
                <>
                  <dt>Reason</dt>
                  <dd>{order.reason}</dd>
                </>
              )}
            </dl>
            <p className="card-hint facts-note">
              {leftWindow
                ? 'This order has left the live window. These are the last values the read model sent.'
                : 'Orders stay in the live window for as long as the API keeps their saga; older ones leave it.'}
            </p>
            <a className="quiet-button facts-link" href="#/ops">
              Open control tower
            </a>
          </section>
        </div>
      ) : pending ? (
        <p className="empty" role="status">
          Placing your order…
        </p>
      ) : (
        <section className="card empty-card" aria-labelledby="outside-window">
          <h2 id="outside-window">This order is older than the live window.</h2>
          <p className="card-hint">
            The demo keeps a rolling window of recent orders, so a page reload starts a new
            simulation and the link above no longer resolves. Place an order and its saga stays
            here from start to decision.
          </p>
          <a className="button empty-action" href="#/">
            Order something
          </a>
        </section>
      )}
    </>
  );
}
