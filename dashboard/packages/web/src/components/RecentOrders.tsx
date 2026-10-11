import { Fragment, useState } from 'react';
import type { OrderView, TimelineEntry } from '@orderflow/contracts';
import { eventLabel, shortId, topicOf } from '../lib/events';
import { formatAgo, formatDuration, formatMoney } from '../lib/format';

const STATUS_TEXT: Record<OrderView['status'], string> = {
  placed: 'Awaiting decision',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

/** Recent orders; selecting one shows its saga, step by step, across both topics. */
export function RecentOrders({ orders, now, currency }: { orders: OrderView[]; now: Date; currency: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const traceable = orders.some((o) => o.timeline?.length);

  return (
    <section className="card wide" aria-labelledby="orders-title">
      <h2 id="orders-title">Recent orders</h2>
      {traceable && <p className="card-hint">Select an order to trace its saga through Kafka.</p>}
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
            {orders.map((o) => {
              const open = openId === o.orderId && !!o.timeline?.length;
              return (
                <Fragment key={o.orderId}>
                  <tr className={open ? 'row-open' : undefined}>
                    <td className="mono" title={o.orderId}>
                      {o.timeline?.length ? (
                        <button
                          type="button"
                          className="trace-toggle"
                          aria-expanded={open}
                          aria-controls={`trace-${o.orderId}`}
                          onClick={() => setOpenId(open ? null : o.orderId)}
                        >
                          <span aria-hidden="true">{open ? '▾' : '▸'}</span> {shortId(o.orderId)}
                        </button>
                      ) : (
                        shortId(o.orderId)
                      )}
                    </td>
                    <td>
                      <span className={`pill pill-${o.status}`}>{STATUS_TEXT[o.status]}</span>
                      {o.reason ? <span className="reason"> {o.reason}</span> : null}
                    </td>
                    <td className="num hide-narrow">{o.itemCount ?? '—'}</td>
                    <td className="num">{formatMoney(o.totalCents, currency)}</td>
                    <td>
                      <time dateTime={o.updatedAt}>{formatAgo(o.updatedAt, now)}</time>
                    </td>
                  </tr>
                  {open && (
                    <tr className="trace-row">
                      <td colSpan={5} id={`trace-${o.orderId}`}>
                        <SagaTrace steps={o.timeline!} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** One order's events in order, each with its offset from the first and the topic it crossed. */
export function SagaTrace({ steps }: { steps: TimelineEntry[] }) {
  const start = Date.parse(steps[0]!.occurredAt);
  return (
    <ol className="trace" aria-label="Saga trace">
      {steps.map((s, i) => (
        <li key={`${s.eventType}-${i}`} className={`trace-step trace-${topicOf(s.eventType)}`}>
          <span className="trace-name">{eventLabel(s.eventType)}</span>
          <span className="trace-meta">
            <span className="mono">{topicOf(s.eventType)}.events.v1</span>
            {' · '}
            {i === 0 ? 'start' : `+${formatDuration(Date.parse(s.occurredAt) - start)}`}
          </span>
        </li>
      ))}
    </ol>
  );
}
