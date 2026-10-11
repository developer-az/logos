import type { ThroughputPoint } from '@orderflow/contracts';
import type { DataMode } from '../hooks/fallback-source';
import { formatCount } from '../lib/format';

/**
 * The architecture, drawn with live numbers: which service publishes to which topic, and how
 * many events crossed each topic in the last complete minute. The saga is a loop (orders go to
 * inventory, decisions come back), and the dashboard's read model consumes both topics.
 */
export function PipelineFlow({ throughput, mode }: { throughput: ThroughputPoint[]; mode: DataMode }) {
  // The current minute is still filling up, so rates use the last complete one.
  const last = throughput[throughput.length - 2];
  const orders = last?.orders ?? 0;
  const inventory = last?.inventory ?? 0;
  const simulated = mode === 'simulated';

  return (
    <section className="card wide pipeline" aria-labelledby="pipeline-title">
      <h2 id="pipeline-title">How an order flows</h2>
      <div className="flow">
        <Node name="Order service" detail="C# · .NET 10 · PostgreSQL + outbox" simulated={simulated} />
        <div className="topics">
          <Topic name="orders.events.v1" perMinute={orders} direction="right" what="order placed, cancelled" />
          <Topic
            name="inventory.events.v1"
            perMinute={inventory}
            direction="left"
            what="stock reserved or unavailable"
          />
        </div>
        <Node name="Inventory service" detail="C# · all-or-nothing reservation, no overselling" simulated={simulated} />
      </div>
      <div className="flow-down" aria-hidden="true">both topics ↓</div>
      <div className="flow-sink">
        <Node name="Read model" detail="TypeScript · Kafka consumer → live stream to this page" simulated={simulated} />
      </div>
      <p className="flow-note">
        {simulated
          ? 'Simulated in your browser: the same event contracts and read model, with the network and services replaced by a generator.'
          : 'Events per minute on each Kafka topic, measured by the read model. Every service is idempotent, so redelivered events are counted once.'}
      </p>
    </section>
  );
}

function Node({ name, detail, simulated }: { name: string; detail: string; simulated: boolean }) {
  return (
    <div className="node">
      <div className="node-name">{name}</div>
      <div className="node-detail">{simulated ? 'simulated' : detail}</div>
    </div>
  );
}

function Topic({
  name,
  perMinute,
  direction,
  what,
}: {
  name: string;
  perMinute: number;
  direction: 'left' | 'right';
  what: string;
}) {
  return (
    <div className={`topic topic-${direction}${perMinute > 0 ? ' topic-active' : ''}`}>
      <div className="topic-line" aria-hidden="true">
        <span className="topic-arrow">{direction === 'right' ? '→' : '←'}</span>
      </div>
      <div className="topic-label">
        <span className="mono">{name}</span>
        <strong>{formatCount(perMinute)}/min</strong>
      </div>
      <div className="topic-what">{what}</div>
    </div>
  );
}
