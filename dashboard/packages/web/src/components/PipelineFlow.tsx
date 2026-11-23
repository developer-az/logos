import type { CSSProperties } from 'react';
import type { ThroughputPoint } from '@orderflow/contracts';
import type { DataMode } from '../hooks/fallback-source';
import { formatCount } from '../lib/format';

/**
 * The architecture, drawn with live numbers: which service publishes to which topic, and how
 * many events crossed each topic in the last complete minute. The pulse on each lane travels
 * faster as that topic's rate rises; its direction is the direction of the saga.
 */
export function PipelineFlow({ throughput, mode }: { throughput: ThroughputPoint[]; mode: DataMode }) {
  // The current minute is still filling up, so rates use the last complete one.
  const last = throughput[throughput.length - 2];
  const orders = last?.orders ?? 0;
  const inventory = last?.inventory ?? 0;
  const simulated = mode === 'simulated';

  return (
    <section className="card span-12 pipeline" aria-labelledby="pipeline-title">
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
      <div className="flow-down" aria-hidden="true">both topics feed the read model</div>
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

/** A faster pulse means more events per minute on this topic. */
const pulseSpeed = (rate: number) => `${Math.max(0.7, Math.min(3, 240 / Math.max(1, rate))).toFixed(2)}s`;

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
      <svg className="topic-track" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
        <line className="topic-rail" x1="0" y1="4" x2="100" y2="4" />
        {perMinute > 0 && (
          <line
            className={`topic-signal topic-signal-${direction}`}
            style={{ '--flow-speed': pulseSpeed(perMinute) } as CSSProperties}
            pathLength={100}
            x1="0"
            y1="4"
            x2="100"
            y2="4"
          />
        )}
      </svg>
      <div className="topic-label">
        <span className="mono">{name}</span>
        <strong>{formatCount(perMinute)}/min</strong>
      </div>
      <div className="topic-what">{what}</div>
    </div>
  );
}
