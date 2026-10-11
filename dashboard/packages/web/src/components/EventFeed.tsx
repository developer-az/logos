import type { RecentEvent } from '@orderflow/contracts';
import { eventLabel, shortId, topicOf } from '../lib/events';

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** The newest events as the read model applied them, with the Kafka key they were partitioned by. */
export function EventFeed({ events, limit = 12 }: { events: RecentEvent[]; limit?: number }) {
  const shown = events.slice(0, limit);
  return (
    <section className="card wide" aria-labelledby="feed-title">
      <h2 id="feed-title">Event stream</h2>
      {shown.length === 0 ? (
        <p className="empty">No events yet.</p>
      ) : (
        <ol className="feed">
          {shown.map((e) => (
            <li key={e.eventId}>
              <time className="mono feed-time" dateTime={e.occurredAt}>
                {clock(e.occurredAt)}
              </time>
              <span className={`chip chip-${topicOf(e.eventType)}`}>{eventLabel(e.eventType)}</span>
              <span className="mono feed-key" title={`Kafka key ${e.key}`}>
                {shortId(e.key)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
