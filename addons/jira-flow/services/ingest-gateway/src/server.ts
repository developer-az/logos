import { buildApp } from './app';
import { loadConfig } from './config';
import { KafkaPublisher } from './publisher';

async function main() {
  const config = loadConfig();
  const publisher = new KafkaPublisher({
    brokers: config.kafkaBrokers,
    topic: config.kafkaTopic,
    clientId: 'ingest-gateway',
    sasl: config.kafkaSasl,
    caPath: config.kafkaCaPath,
  });
  const app = buildApp({ publisher, webhookSecret: config.webhookSecret, logger: true });

  // Kubernetes sends SIGTERM on rollout; drain in-flight requests, then flush the producer.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, async () => {
      await app.close();
      await publisher.close();
      process.exit(0);
    });
  }

  await app.listen({ host: '0.0.0.0', port: config.port });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
