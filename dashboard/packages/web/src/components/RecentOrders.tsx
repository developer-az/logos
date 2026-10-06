import type { OrderView } from '@orderflow/contracts';
import { formatAgo, formatMoney } from '../lib/format';

const STATUS_TEXT: Record<OrderView['status'], string> = {
  placed: 'Awaiting decision',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

/** Order ids are GUIDs; the first block is enough to tell rows apart, the full id is on hover. */
const shortId = (id: string) => (/^[0-9a-f]{8}-/i.test(id) ? id.slice(0, 8) : id);

export function RecentOrders({ orders, now, currency }: { orders: OrderView[]; now: Date; currency: string }) {
  return (
    <section className="card wide" aria-labelledby="orders-title">
      <h2 id="orders-title">Recent orders</h2>
      {orders.length === 0 ? (
        <p className="empty">No orders yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Status</th>
              <th scope="col" className="num hide-narrow">Items</th>
              <th scope="col" className="num">Total</th>
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.orderId}>
                <td className="mono" title={o.orderId}>
                  {shortId(o.orderId)}
                </td>
                <td>
                  <span className={`pill pill-${o.status}`}>{STATUS_TEXT[o.status]}</span>
                  {o.reason ? <span className="reason"> {o.reason}</span> : null}
                </td>
                <td className="num hide-narrow">{o.itemCount ?? "—"}</td>
                <td className="num">{formatMoney(o.totalCents, currency)}</td>
                <td>
                  <time dateTime={o.updatedAt}>{formatAgo(o.updatedAt, now)}</time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
