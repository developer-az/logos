import { useEffect, useState, useSyncExternalStore } from 'react';
import { ConnectionBadge } from './components/ConnectionBadge';
import { EventFeed } from './components/EventFeed';
import { KpiTiles } from './components/KpiTiles';
import { LowStockTable } from './components/LowStockTable';
import { RecentOrders } from './components/RecentOrders';
import { PipelineFlow } from './components/PipelineFlow';
import { StatusBars } from './components/StatusBars';
import { ThroughputChart } from './components/ThroughputChart';
import type { DataMode, ModeStore } from './hooks/fallback-source';
import { useLiveSnapshot, type EventSourceFactory } from './hooks/useLiveSnapshot';
import { formatAgo, formatCount } from './lib/format';

export function App({
  streamUrl,
  createEventSource,
  demo = false,
  mode: modeStore,
}: {
  streamUrl?: string;
  createEventSource?: EventSourceFactory;
  /** Public demo: events are simulated in the browser rather than read from Kafka. */
  demo?: boolean;
  /** Public build with a live backend: reports whether it is live or fell back to simulation. */
  mode?: ModeStore;
}) {
  const { snapshot, connection, receivedAt } = useLiveSnapshot(streamUrl, createEventSource);
  const now = useNow(5_000);
  const reported = useSyncExternalStore(
    (modeStore ?? ALWAYS_LIVE).subscribe,
    (modeStore ?? ALWAYS_LIVE).get,
  );
  const mode: DataMode = demo ? 'simulated' : reported;
  const fellBack = !!modeStore && reported === 'simulated';

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="https://github.com/developer-az/logos">
            <BrandMark />
            <span>Orderflow</span>
          </a>
          <span className="brand-scope">Order &amp; inventory events</span>
          <div className="topbar-right">
            <ConnectionBadge connection={connection} caughtUp={snapshot?.caughtUp ?? null} />
            {receivedAt && <span className="freshness">Updated {formatAgo(receivedAt.toISOString(), now)}</span>}
          </div>
        </div>
      </div>

      <main className="page">
        <div className="title-row">
          <div>
            <h1>Orderflow Live</h1>
            <p className="sub">
              {mode === 'simulated'
                ? 'Orders and inventory, simulated live in your browser'
                : 'Orders and inventory, straight from Kafka'}
            </p>
          </div>
        </div>

        {modeStore && reported === 'live' && (
          <p className="notice live-notice">
            Live. Every number on this page comes from the C# order and inventory services, through
            Kafka, on free-tier cloud hosting. Open an order below to trace its saga.{' '}
            <a href="https://github.com/developer-az/logos">Source and architecture</a>
          </p>
        )}

        {fellBack && (
          <p className="notice demo-notice">
            The live backend can't be reached right now, so this is the project's simulator running
            in your browser, through the same contract validation and read model as production.{' '}
            <a href="https://github.com/developer-az/logos">Source and architecture</a>
          </p>
        )}

        {demo && (
          <p className="notice demo-notice">
            Public demo. The events are generated in your browser by the project's simulator and run
            through the same contract validation and read model as production. The real deployment
            reads them from Kafka, fed by the C# order and inventory services on Kubernetes.{' '}
            <a href="https://github.com/developer-az/logos">Source and architecture</a>
          </p>
        )}

        {!snapshot ? (
          <p className="empty" role="status">
            Waiting for the first update…
          </p>
        ) : (
          <>
            {!snapshot.caughtUp && (
              <p className="notice" role="status">
                Replaying event history. Numbers will settle once the dashboard has caught up.
              </p>
            )}
            <KpiTiles snapshot={snapshot} />
            <div className="workbench">
              <PipelineFlow throughput={snapshot.throughput} mode={mode} />
              <ThroughputChart points={snapshot.throughput} />
              <div className="stack span-4">
                <StatusBars byStatus={snapshot.orders.byStatus} />
                <LowStockTable
                  items={snapshot.inventory.lowStock}
                  threshold={snapshot.inventory.lowStockThreshold}
                  skus={snapshot.inventory.skus}
                />
              </div>
              <RecentOrders orders={snapshot.orders.recent} now={now} currency={snapshot.currency} />
              <EventFeed events={snapshot.recentEvents} />
            </div>
            <footer className="consumer" aria-label="Consumer health">
              {formatCount(snapshot.consumer.processed)} events applied ·{' '}
              {formatCount(snapshot.consumer.duplicates)} duplicates ignored ·{' '}
              {formatCount(snapshot.consumer.invalid)} invalid {mode === 'simulated' ? 'rejected' : 'dead-lettered'} ·{' '}
              {formatCount(snapshot.consumer.unsupported)} unknown types skipped
            </footer>
          </>
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
