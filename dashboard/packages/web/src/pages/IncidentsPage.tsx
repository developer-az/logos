import { useState } from 'react';
import type { DashboardSnapshot } from '@orderflow/contracts';
import type { ActionResult, CommerceActions, MaybePromise } from '../lib/commerce';
import { formatAgo, formatCount } from '../lib/format';

interface LogEntry {
  tone: 'ok' | 'error';
  text: string;
  at: Date;
}

/**
 * The failure paths, made clickable. Each button pushes a message through the same validation the
 * Kafka consumer uses, so the counters and the dead-letter list are the projection's real state,
 * not a scripted animation.
 */
export function IncidentsPage({
  snapshot,
  actions,
  now,
}: {
  snapshot: DashboardSnapshot | null;
  actions: CommerceActions;
  now: Date;
}) {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const disabled = !!actions.unavailableReason || !snapshot || running;

  const run = async (label: string, action: () => MaybePromise<ActionResult>) => {
    setRunning(true);
    try {
      const result = await action();
      setLog((current) =>
        [
          {
            tone: result.ok ? ('ok' as const) : ('error' as const),
            text: result.ok ? `${label}: ${result.message}` : `${label}: ${result.error}`,
            at: new Date(),
          },
          ...current,
        ].slice(0, 6),
      );
    } finally {
      setRunning(false);
    }
  };

  const counters = snapshot?.consumer;

  return (
    <>
      <header className="masthead">
        <div className="masthead-main">
          <p className="eyebrow">
            <span className="eyebrow-index">04</span>
            Incidents
          </p>
          <h1>Break it on purpose.</h1>
          <p className="lede">
            Publish a duplicate and a malformed message, then replay the dead letter. The counters
            are the consumer's own, not a scripted animation.
          </p>
        </div>
        <dl className="masthead-meta">
          <div>
            <dt>Applied</dt>
            <dd>{formatCount(counters?.processed ?? 0)}</dd>
          </div>
          <div>
            <dt>Duplicates</dt>
            <dd>{formatCount(counters?.duplicates ?? 0)}</dd>
          </div>
          <div>
            <dt>Dead-lettered</dt>
            <dd>{formatCount(counters?.invalid ?? 0)}</dd>
          </div>
        </dl>
      </header>

      {actions.unavailableReason && <p className="notice">{actions.unavailableReason}</p>}

      <div className="workbench">
        <section className="card span-8" aria-labelledby="lab-title">
          <h2 id="lab-title">Incident lab</h2>
          <p className="card-hint">
            Each action publishes a message to the same pipeline the dashboard reads. The counters
            below are the consumer's own.
          </p>
          <div className="lab-actions">
            <button
              type="button"
              className="quiet-button"
              disabled={disabled}
              onClick={() => void run('Duplicate', () => actions.sendDuplicate())}
            >
              Send a duplicate event
            </button>
            <button
              type="button"
              className="quiet-button"
              disabled={disabled}
              onClick={() => void run('Malformed', () => actions.sendMalformed())}
            >
              Send a malformed event
            </button>
            <button
              type="button"
              className="quiet-button"
              disabled={disabled}
              onClick={() => void run('Replay', () => actions.replayDeadLetter())}
            >
              Replay the last dead letter
            </button>
          </div>

          {log.length > 0 && (
            <ul className="lab-log" aria-label="Lab results">
              {log.map((entry, i) => (
                <li key={`${entry.at.toISOString()}-${i}`} className={`lab-${entry.tone}`}>
                  <span>{entry.text}</span>
                  <time dateTime={entry.at.toISOString()}>{formatAgo(entry.at.toISOString(), now)}</time>
                </li>
              ))}
            </ul>
          )}

          <h3 className="lab-subhead">What is proven</h3>
          <ul className="lab-notes">
            <li>
              <strong>Duplicates</strong> are dropped by event id, so a redelivered confirmation
              cannot charge twice or confirm an order twice.
            </li>
            <li>
              <strong>Malformed messages</strong> never reach the read model. In the Kafka deployment
              they go to <span className="mono">*.events.v1.dlt</span>; here the body is kept so you
              can see what was refused.
            </li>
            <li>
              <strong>Replaying a poison message</strong> fails the same way again. A retry is not a
              fix; the contract or the producer has to change.
            </li>
          </ul>
        </section>

        <section className="card span-4" aria-labelledby="counters-title">
          <h2 id="counters-title">Consumer</h2>
          <p className="card-hint">Cumulative for this page session.</p>
          <dl className="facts">
            <dt>Applied</dt>
            <dd>{counters ? formatCount(counters.processed) : '—'}</dd>
            <dt>Duplicates ignored</dt>
            <dd>{counters ? formatCount(counters.duplicates) : '—'}</dd>
            <dt>Invalid</dt>
            <dd>{counters ? formatCount(counters.invalid) : '—'}</dd>
            <dt>Unknown types</dt>
            <dd>{counters ? formatCount(counters.unsupported) : '—'}</dd>
            <dt>Illegal transitions</dt>
            <dd>{counters ? formatCount(counters.ignoredTransitions) : '—'}</dd>
            <dt>Stale snapshots</dt>
            <dd>{counters ? formatCount(counters.staleSnapshots) : '—'}</dd>
          </dl>
        </section>

        <section className="card span-12" aria-labelledby="dlq-title">
          <div className="panel-head">
            <div>
              <h2 id="dlq-title">Dead letters</h2>
              <p className="card-hint">
                The bodies the consumer refused, with the error that stopped each one. Newest first.
              </p>
            </div>
          </div>
          {!snapshot || snapshot.deadLetters.length === 0 ? (
            <p className="empty">Nothing has been dead-lettered.</p>
          ) : (
            <ul className="dlq">
              {snapshot.deadLetters.map((letter, i) => (
                <li key={`${letter.at}-${i}`}>
                  <div className="dlq-head">
                    <span className="mono">{letter.eventType ?? 'unparsed'}</span>
                    <span>{formatAgo(letter.at, now)}</span>
                  </div>
                  <code className="dlq-raw">{letter.raw}</code>
                  <p className="dlq-error">{letter.error}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

