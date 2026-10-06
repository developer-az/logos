import { useEffect, useState } from 'react';
import { ConnectionBadge } from './components/ConnectionBadge';
import { KpiTiles } from './components/KpiTiles';
import { LowStockTable } from './components/LowStockTable';
import { RecentOrders } from './components/RecentOrders';
import { StatusBars } from './components/StatusBars';
import { ThroughputChart } from './components/ThroughputChart';
import { useLiveSnapshot, type EventSourceFactory } from './hooks/useLiveSnapshot';
import { formatAgo, formatCount } from './lib/format';

export function App({ streamUrl, createEventSource }: { streamUrl?: string; createEventSource?: EventSourceFactory }) {
  const { snapshot, connection, receivedAt } = useLiveSnapshot(streamUrl, createEventSource);
  const now = useNow(5_000);

  return (
    <div className="page">
      <header className="top">
        <div>
          <h1>Orderflow Live</h1>
          <p className="sub">Orders and inventory, straight from Kafka</p>
        </div>
        <div className="top-right">
          <ConnectionBadge connection={connection} caughtUp={snapshot?.caughtUp ?? null} />
          {receivedAt && <span className="sub">Updated {formatAgo(receivedAt.toISOString(), now)}</span>}
        </div>
      </header>

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
            <ThroughputChart points={snapshot.throughput} />
            <StatusBars byStatus={snapshot.orders.byStatus} />
            <LowStockTable
              items={snapshot.inventory.lowStock}
              threshold={snapshot.inventory.lowStockThreshold}
              skus={snapshot.inventory.skus}
            />
            <RecentOrders orders={snapshot.orders.recent} now={now} currency={snapshot.currency} />
          </div>
          <footer className="consumer" aria-label="Consumer health">
            {formatCount(snapshot.consumer.processed)} events applied ·{' '}
            {formatCount(snapshot.consumer.duplicates)} duplicates ignored ·{' '}
            {formatCount(snapshot.consumer.invalid)} invalid dead-lettered ·{' '}
            {formatCount(snapshot.consumer.unsupported)} unknown types skipped
          </footer>
        </main>
      )}
    </div>
  );
}

function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
