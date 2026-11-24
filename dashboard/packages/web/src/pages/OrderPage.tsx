import type { DashboardSnapshot } from '@orderflow/contracts';
import { SagaSpotlight } from '../components/SagaSpotlight';

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
  const order = snapshot?.orders.recent.find((o) => o.orderId === orderId);

  return (
    <>
      <div className="title-row">
        <div>
          <h1>Order</h1>
          <p className="sub mono">{orderId}</p>
        </div>
        <a className="quiet-button" href="#/">
          Back to store
        </a>
      </div>

      {!snapshot ? (
        <p className="empty" role="status">
          Waiting for the first update…
        </p>
      ) : order ? (
        <SagaSpotlight order={order} now={now} currency={currency} />
      ) : pending ? (
        <p className="empty" role="status">
          Placing your order…
        </p>
      ) : (
        <p className="empty">This order is older than the live window.</p>
      )}
    </>
  );
}
