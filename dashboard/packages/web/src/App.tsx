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
    <div className="page">
      <header className="top">
        <div>
          <h1>Orderflow Live</h1>
          <p className="sub">
            {mode === 'simulated'
              ? 'Orders and inventory, simulated live in your browser'
              : 'Orders and inventory, straight from Kafka'}
          </p>
        </div>
        <div className="top-right">
          <ConnectionBadge connection={connection} caughtUp={snapshot?.caughtUp ?? null} />
          {receivedAt && <span className="sub">Updated {formatAgo(receivedAt.toISOString(), now)}</span>}
        </div>
      </header>

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
        <main>
          {!snapshot.caughtUp && (
            <p className="notice" role="status">
              Replaying event history. Numbers will settle once the dashboard has caught up.
            </p>
          )}
          <KpiTiles snapshot={snapshot} />
          <div className="grid">
            <PipelineFlow throughput={snapshot.throughput} mode={mode} />
            <ThroughputChart points={snapshot.throughput} />
            <StatusBars byStatus={snapshot.orders.byStatus} />
            <LowStockTable
              items={snapshot.inventory.lowStock}
              threshold={snapshot.inventory.lowStockThreshold}
              skus={snapshot.inventory.skus}
            />
            <RecentOrders orders={snapshot.orders.recent} now={now} currency={snapshot.currency} />
            <EventFeed events={snapshot.recentEvents} />
          </div>
          <footer className="consumer" aria-label="Consumer health">
            {formatCount(snapshot.consumer.processed)} events applied ·{' '}
            {formatCount(snapshot.consumer.duplicates)} duplicates ignored ·{' '}
            {formatCount(snapshot.consumer.invalid)} invalid {mode === 'simulated' ? 'rejected' : 'dead-lettered'} ·{' '}
            {formatCount(snapshot.consumer.unsupported)} unknown types skipped
          </footer>
        </main>
      )}
    </div>
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
