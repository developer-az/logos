import { readFileSync } from 'node:fs';
import {
  Kafka,
  Partitioners,
  logLevel,
  type Consumer,
  type KafkaConfig,
  type Producer,
  type SASLOptions,
} from 'kafkajs';
import type { Config } from '../config';
import type { Metrics } from '../metrics';
import type { Projection } from '../projection/projection';
import { CatchUpTracker, type PartitionRange } from './catch-up';
import { createMessageHandler, type DeadLetter } from './handler';

export interface Logger {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

export interface RunningConsumer {
  /** Undefined until the startup end offsets have been read. */
  readonly tracker: CatchUpTracker | undefined;
  /** False after the consumer crashed without restarting; liveness should then fail. */
  readonly healthy: boolean;
  stop(): Promise<void>;
}

export function kafkaClientConfig(cfg: Config['kafka'], log?: Logger): KafkaConfig {
  return {
    clientId: cfg.clientId,
    brokers: cfg.brokers,
    ssl: cfg.tls
      ? {
          ...(cfg.tls.caFile && { ca: [readFileSync(cfg.tls.caFile, 'utf8')] }),
          ...(cfg.tls.certFile && { cert: readFileSync(cfg.tls.certFile, 'utf8') }),
          ...(cfg.tls.keyFile && { key: readFileSync(cfg.tls.keyFile, 'utf8') }),
        }
      : cfg.ssl,
    // The config schema guarantees one of the mechanisms kafkajs accepts.
    sasl: (cfg.sasl ?? undefined) as SASLOptions | undefined,
    logLevel: logLevel.WARN,
    // Route kafkajs's own logs (retries, rebalances) through the service logger as JSON.
    logCreator: log
      ? () =>
          ({ level, log: entry }) => {
            const { message, ...rest } = entry;
            const obj = { kafka: rest };
            if (level === logLevel.ERROR) log.error(obj, `kafkajs: ${message}`);
            else if (level === logLevel.WARN) log.warn(obj, `kafkajs: ${message}`);
            else log.info(obj, `kafkajs: ${message}`);
          }
      : undefined,
    retry: { retries: 8, initialRetryTime: 300 },
  };
}

/**
 * Starts consuming the order and inventory topics into the projection.
 *
 * Startup sequence: wait for the topics to exist, capture their end offsets (the catch-up
 * target for readiness), then replay from the beginning in a consumer group unique to this
 * process. Returns as soon as consumption is running; replay continues in the background.
 */
export async function startConsumer(opts: {
  config: Config['kafka'];
  projection: Projection;
  metrics: Metrics;
  log: Logger;
  signal?: AbortSignal;
}): Promise<RunningConsumer> {
  const { config, projection, metrics, log } = opts;
  const kafka = new Kafka(kafkaClientConfig(config, log));
  const admin = kafka.admin();
  let tracker: CatchUpTracker | undefined;
  let healthy = true;
  let producer: Producer | undefined;
  let consumer: Consumer | undefined;

  await admin.connect();
  try {
    await waitForTopics(admin, config.topics, log, opts.signal);
    const ranges: PartitionRange[] = [];
    for (const topic of config.topics) {
      for (const p of await admin.fetchTopicOffsets(topic)) {
        ranges.push({ topic, partition: p.partition, low: p.low, high: p.high });
      }
    }
    tracker = new CatchUpTracker(ranges);
    log.info(
      { partitions: ranges.length, pending: tracker.pendingPartitions },
      'captured catch-up target',
    );
  } finally {
    await admin.disconnect();
  }

  const dltFor = config.deadLetter;
  if (dltFor) {
    // The services provision `<topic>.dlt`; a missing one should fail loudly, not be auto-created.
    producer = kafka.producer({
      allowAutoTopicCreation: false,
      createPartitioner: Partitioners.DefaultPartitioner,
    });
    await producer.connect();
  }
  const deadLetter =
    producer && dltFor
      ? async (l: DeadLetter) => {
          await producer!.send({
            topic: dltFor(l.sourceTopic),
            messages: [{ key: l.key, value: l.value, headers: deadLetterHeaders(l, config.clientId) }],
          });
        }
      : undefined;

  consumer = kafka.consumer({ groupId: config.groupId, allowAutoTopicCreation: false });
  consumer.on(consumer.events.CRASH, (e) => {
    log.error({ error: e.payload.error.message, restart: e.payload.restart }, 'consumer crashed');
    if (!e.payload.restart) healthy = false;
  });
  await consumer.connect();
  await consumer.subscribe({ topics: config.topics, fromBeginning: true });

  const handle = createMessageHandler({
    projection,
    tracker: () => tracker,
    metrics,
    deadLetter,
    log,
  });
  await consumer.run({
    eachMessage: async (payload) => {
      await handle(payload);
      metrics.caughtUp.set(tracker?.caughtUp ? 1 : 0);
    },
  });
  metrics.caughtUp.set(tracker.caughtUp ? 1 : 0);
  log.info({ groupId: config.groupId, topics: config.topics }, 'consuming');

  return {
    get tracker() {
      return tracker;
    },
    get healthy() {
      return healthy;
    },
    async stop() {
      await consumer?.disconnect();
      await producer?.disconnect();
    },
  };
}

/** Header names follow the platform's dead-letter convention (services/docs/events.md). */
export function deadLetterHeaders(l: DeadLetter, consumer: string): Record<string, string> {
  return {
    'dlt-source-topic': l.sourceTopic,
    'dlt-source-partition': String(l.partition),
    'dlt-source-offset': l.offset,
    // Validation errors are deterministic, so the dashboard never retries them.
    'dlt-attempts': '1',
    'dlt-error': `ContractValidation: ${l.error}`.slice(0, 1000),
    'dlt-consumer': consumer,
  };
}

async function waitForTopics(
  admin: ReturnType<Kafka['admin']>,
  topics: readonly string[],
  log: Logger,
  signal?: AbortSignal,
): Promise<void> {
  for (let delay = 500; ; delay = Math.min(delay * 2, 10_000)) {
    const existing = new Set(await admin.listTopics());
    const missing = topics.filter((t) => !existing.has(t));
    if (missing.length === 0) return;
    if (signal?.aborted) throw new Error('aborted while waiting for topics');
    log.warn({ missing, retryInMs: delay }, 'waiting for topics to be created');
    await new Promise((r) => setTimeout(r, delay));
  }
}
