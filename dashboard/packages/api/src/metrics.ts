import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client';

export interface Metrics {
  registry: Registry;
  events: Counter<'event_type' | 'outcome'>;
  invalid: Counter<'topic'>;
  unsupported: Counter;
  deadLettered: Counter<'topic'>;
  streamClients: Gauge;
  caughtUp: Gauge;
}

export function createMetrics(opts: { defaultMetrics?: boolean } = {}): Metrics {
  const registry = new Registry();
  if (opts.defaultMetrics) collectDefaultMetrics({ register: registry });
  return {
    registry,
    events: new Counter({
      name: 'orderflow_dashboard_events_total',
      help: 'Valid events consumed, by type and outcome (applied or duplicate)',
      labelNames: ['event_type', 'outcome'] as const,
      registers: [registry],
    }),
    invalid: new Counter({
      name: 'orderflow_dashboard_invalid_messages_total',
      help: 'Messages that failed contract validation and were skipped',
      labelNames: ['topic'] as const,
      registers: [registry],
    }),
    unsupported: new Counter({
      name: 'orderflow_dashboard_unsupported_events_total',
      // No event_type label: the value comes from producers, so it would be unbounded.
      help: 'Well-formed events of a type or schema version the dashboard skips',
      registers: [registry],
    }),
    deadLettered: new Counter({
      name: 'orderflow_dashboard_dead_lettered_total',
      help: 'Invalid messages forwarded to the dead-letter topic',
      labelNames: ['topic'] as const,
      registers: [registry],
    }),
    streamClients: new Gauge({
      name: 'orderflow_dashboard_stream_clients',
      help: 'Open live-update (SSE) connections',
      registers: [registry],
    }),
    caughtUp: new Gauge({
      name: 'orderflow_dashboard_caught_up',
      help: '1 once the consumer has replayed the topics to their startup end offsets',
      registers: [registry],
    }),
  };
}
