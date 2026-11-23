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

const PREVIEW = 6;

/**
 * Recent orders. On the dashboard, selecting one drives the SagaSpotlight above; on its own,
 * selecting one expands its trace inline. Either way the row has one obvious purpose.
 */
export function RecentOrders({
  orders,
  now,
  currency,
  selectedId,
  onSelect,
}: {
  orders: OrderView[];
  now: Date;
  currency: string;
  selectedId?: string;
  onSelect?: (orderId: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const selectable = !!onSelect;
  const traceable = orders.some((o) => o.timeline?.length);
  const shown = showAll ? orders : orders.slice(0, PREVIEW);

  return (
    <section className="card span-12" aria-labelledby="orders-title">
      <div className="panel-head">
        <div>
          <h2 id="orders-title">Recent orders</h2>
          {traceable && (
            <p className="card-hint">
              {selectable ? 'Select an order to trace it above.' : 'Select an order to trace its saga through Kafka.'}
            </p>
          )}
        </div>
        {orders.length > PREVIEW && (
          <button type="button" className="quiet-button" onClick={() => setShowAll(!showAll)}>
            {showAll ? `Show ${PREVIEW}` : `All ${orders.length}`}
          </button>
        )}
      </div>
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
            {shown.map((o) => {
              const open = !selectable && openId === o.orderId && !!o.timeline?.length;
              const selected = selectable && selectedId === o.orderId;
              return (
                <Fragment key={o.orderId}>
                  <tr className={open ? 'row-open' : undefined} data-selected={selectable ? selected : undefined}>
                    <td className="mono" title={o.orderId}>
                      {o.timeline?.length ? (
                        <button
                          type="button"
                          className={`trace-toggle${selected ? ' is-selected' : ''}`}
                          aria-expanded={selectable ? undefined : open}
                          aria-pressed={selectable ? selected : undefined}
                          aria-controls={selectable ? undefined : `trace-${o.orderId}`}
                          onClick={() => (selectable ? onSelect!(o.orderId) : setOpenId(open ? null : o.orderId))}
                        >
                          {shortId(o.orderId)}
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

/** Compact inline trace used when the component stands alone. */
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
