import { useState } from 'react';
import type { DashboardSnapshot } from '@orderflow/contracts';
import { EventFeed } from '../components/EventFeed';
import { KpiTiles } from '../components/KpiTiles';
import { LowStockTable } from '../components/LowStockTable';
import { RecentOrders } from '../components/RecentOrders';
import { SagaSpotlight } from '../components/SagaSpotlight';
import { StatusBars } from '../components/StatusBars';
import { ThroughputChart } from '../components/ThroughputChart';
import type { DataMode } from '../hooks/fallback-source';
import { formatCount } from '../lib/format';

export function ControlTower({
  snapshot,
  now,
  mode,
  fellBack,
  demo,
  live,
}: {
  snapshot: DashboardSnapshot | null;
  now: Date;
  mode: DataMode;
  fellBack: boolean;
  demo: boolean;
  live: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const recent = snapshot?.orders.recent ?? [];
  const traceable = recent.filter((o) => o.timeline?.length);
  const traced = traceable.find((o) => o.orderId === selectedId) ?? traceable[0];

  return (
    <>
      <header className="masthead">
        <div className="masthead-main">
          <p className="eyebrow">
            <span className="eyebrow-index">05</span>
            Control tower
          </p>
          <h1>Watch it work.</h1>
          <p className="lede">
            Throughput, decisions, and one order’s path across both topics, with the time each step
            took. Every figure is folded from the same event stream the systems write to.
          </p>
        </div>
      </header>

      {live && (
        <p className="notice live-notice">
          Live. Every number here comes from the C# services through Kafka. Open an order to trace its saga.{' '}
          <a href="https://github.com/developer-az/logos">Source and architecture</a>
        </p>
      )}

      {fellBack && (
        <p className="notice demo-notice">
          The live backend can't be reached, so this is the browser simulator running the same contracts and read
          model as production. <a href="https://github.com/developer-az/logos">Source and architecture</a>
        </p>
      )}

      {demo && (
        <p className="notice demo-notice">
          Public demo. Events are generated in your browser, not read from Kafka.{' '}
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

          <p className="consumer" aria-label="Consumer health">
            {formatCount(snapshot.consumer.processed)} events applied ·{' '}
            {formatCount(snapshot.consumer.duplicates)} duplicates ignored ·{' '}
            {formatCount(snapshot.consumer.invalid)} invalid {mode === 'simulated' ? 'rejected' : 'dead-lettered'} ·{' '}
            {formatCount(snapshot.consumer.unsupported)} unknown types skipped
          </p>

          <KpiTiles snapshot={snapshot} />

          <div className="workbench">
            <SagaSpotlight order={traced} now={now} currency={snapshot.currency} />
            <ThroughputChart points={snapshot.throughput} />
            <div className="stack span-4">
              <StatusBars byStatus={snapshot.orders.byStatus} />
              <LowStockTable
                items={snapshot.inventory.lowStock}
                threshold={snapshot.inventory.lowStockThreshold}
                skus={snapshot.inventory.skus}
              />
            </div>
            <RecentOrders
              orders={recent}
              now={now}
              currency={snapshot.currency}
              selectedId={traced?.orderId}
              onSelect={setSelectedId}
            />
            <details className="card span-12 raw-stream">
              <summary>Event stream · {formatCount(snapshot.recentEvents.length)} recent events</summary>
              <EventFeed events={snapshot.recentEvents} />
            </details>
          </div>
        </>
      )}
    </>
  );
}
