import type { CSSProperties } from 'react';
import type { OrderView } from '@orderflow/contracts';
import { eventLabel, shortId, topicOf } from '../lib/events';
import { formatAgo, formatDuration, formatMoney } from '../lib/format';

const STATUS_TEXT: Record<OrderView['status'], string> = {
  placed: 'Awaiting decision',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

/**
 * The one thing this dashboard exists to show: a single order's events, in order, across both
 * Kafka topics, with the time each step took. Selecting a row in Recent orders changes this.
 */
export function SagaSpotlight({
  order,
  now,
  currency,
}: {
  order?: OrderView;
  now: Date;
  currency: string;
}) {
  if (!order?.timeline?.length) {
    return (
      <section className="card span-12 spotlight" aria-labelledby="spotlight-title">
        <h2 id="spotlight-title">Trace one order</h2>
        <p className="empty">No order with a trace yet.</p>
      </section>
    );
  }

  const steps = order.timeline;
  const start = Date.parse(steps[0]!.occurredAt);
  const end = Date.parse(steps[steps.length - 1]!.occurredAt);
  const topics = new Set(steps.map((s) => topicOf(s.eventType)));
  const last = steps[steps.length - 1]!;

  return (
    <section className="card span-12 spotlight" aria-labelledby="spotlight-title">
      <div className="spotlight-head">
        <div>
          <h2 id="spotlight-title">Trace one order</h2>
          <p className="spotlight-order">
            <span className="mono" title={order.orderId}>{shortId(order.orderId)}</span>
            <span className={`pill pill-${order.status}`}>{STATUS_TEXT[order.status]}</span>
            {order.totalCents != null && <span className="spotlight-total">{formatMoney(order.totalCents, currency)}</span>}
            <span className="spotlight-age">placed {formatAgo(order.placedAt, now)}</span>
          </p>
          {order.reason && <p className="spotlight-reason">{order.reason}</p>}
        </div>
        <div className="spotlight-summary">
          <strong>{formatDuration(end - start)}</strong>
          <span>from placed to {last.eventType.startsWith('order.') ? 'decision' : 'last event'}</span>
        </div>
      </div>

      <ol className="steps" aria-label="Saga trace">
        {steps.map((s, i) => (
          <li
            key={`${s.eventType}-${i}`}
            className={`step step-${topicOf(s.eventType)}`}
            style={{ '--i': i } as CSSProperties}
          >
            <span className="step-mark" aria-hidden="true" />
            <span className="step-name">{eventLabel(s.eventType)}</span>
            <span className="step-topic mono">{topicOf(s.eventType)}.events.v1</span>
            <span className="step-time">
              {i === 0 ? 'start' : `+${formatDuration(Date.parse(s.occurredAt) - start)}`}
            </span>
          </li>
        ))}
      </ol>

      <p className="spotlight-note">
        {steps.length} events on {topics.size} Kafka {topics.size === 1 ? 'topic' : 'topics'}. Every event is
        contract-validated and deduplicated by event ID before the read model applies it.
      </p>
    </section>
  );
}
