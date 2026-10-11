import { loadConfig } from './config';
import { buildServer } from './http/server';
import { startConsumer, type RunningConsumer } from './kafka/consumer';
import { createMetrics } from './metrics';
import { Projection } from './projection/projection';

async function main(): Promise<void> {
  const config = loadConfig();
  const metrics = createMetrics({ defaultMetrics: true });
  const projection = new Projection({
    lowStockThreshold: config.lowStockThreshold,
    currency: config.currency,
  });
  let consumer: RunningConsumer | undefined;
  let consumerFailed = false;

  const app = buildServer({
    projection,
    metrics,
    caughtUp: () => consumer?.tracker?.caughtUp ?? false,
    healthy: () => !consumerFailed && (consumer?.healthy ?? true),
    streamIntervalMs: config.streamIntervalMs,
    staticDir: config.http.staticDir,
    corsOrigins: config.http.corsOrigins,
    logger: { level: config.logLevel },
  });
  const log = app.log;

  // Serve health endpoints before Kafka is reachable so probes see "alive, not ready"
  // instead of a refused connection while the consumer waits for brokers or topics.
  await app.listen({ port: config.http.port, host: config.http.host });

  const aborter = new AbortController();
  startConsumer({ config: config.kafka, projection, metrics, log, signal: aborter.signal })
    .then((c) => {
      consumer = c;
    })
    .catch((err: Error) => {
      consumerFailed = true;
      log.error({ err }, 'consumer failed to start');
    });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutting down');
    aborter.abort();
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    try {
      await consumer?.stop();
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
