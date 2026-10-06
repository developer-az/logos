/**
 * Publishes simulated order and inventory traffic to Kafka.
 *
 *   npm run simulate -- --rate 5 --duration 120 --duplicate-rate 0.02 --invalid-rate 0.001
 *
 * Uses the same KAFKA_* / *_TOPIC environment variables as the API.
 */
import { parseArgs } from 'node:util';
import { Kafka, Partitioners, type Message } from 'kafkajs';
import { TOPICS, deadLetterTopicFor } from '@orderflow/contracts';
import { loadConfig } from '../config';
import { kafkaClientConfig } from '../kafka/consumer';
import { OrderFlowSimulator, mulberry32, type Envelope } from './generator';

const { values: args } = parseArgs({
  options: {
    rate: { type: 'string', default: '5' },
    duration: { type: 'string', default: '0' },
    seed: { type: 'string', default: String(Date.now() % 2 ** 31) },
    skus: { type: 'string', default: '12' },
    partitions: { type: 'string', default: '3' },
    'duplicate-rate': { type: 'string', default: '0.02' },
    'invalid-rate': { type: 'string', default: '0' },
  },
});

async function main(): Promise<void> {
  const config = loadConfig();
  const rate = Number(args.rate);
  const durationMs = Number(args.duration) * 1000;
  const duplicateRate = Number(args['duplicate-rate']);
  const invalidRate = Number(args['invalid-rate']);
  const seed = Number(args.seed);
  const rand = mulberry32(seed + 1);
  const [ordersTopic, inventoryTopic] = config.kafka.topics as [string, string];
  const topicFor = (e: Envelope) => (e.topic === TOPICS.orders ? ordersTopic : inventoryTopic);

  const kafka = new Kafka({ ...kafkaClientConfig(config.kafka), clientId: 'orderflow-simulator' });
  const admin = kafka.admin();
  await admin.connect();
  const created = await admin.createTopics({
    // Same layout the services provision: each topic plus its dead-letter topic.
    topics: [ordersTopic, inventoryTopic].flatMap((t) => [t, deadLetterTopicFor(t)]).map((topic) => ({
      topic,
      numPartitions: Number(args.partitions),
    })),
  });
  await admin.disconnect();
  if (created) console.log(`created topics for ${ordersTopic}, ${inventoryTopic}`);

  const producer = kafka.producer({
    idempotent: true,
    createPartitioner: Partitioners.DefaultPartitioner,
  });
  await producer.connect();

  const sim = new OrderFlowSimulator({ seed, skus: Number(args.skus) });
  const start = Date.now();
  let sent = 0;
  const send = async (batch: Envelope[]) => {
    const byTopic = new Map<string, Message[]>();
    for (const e of batch) {
      const messages = byTopic.get(topicFor(e)) ?? [];
      const value = JSON.stringify(e.event);
      // Headers the services put on every message.
      const headers = { 'event-id': e.event.eventId, 'event-type': e.event.eventType };
      messages.push({ key: e.key, value, headers });
      // Simulate at-least-once redelivery and the odd malformed producer.
      if (rand() < duplicateRate) messages.push({ key: e.key, value, headers });
      if (rand() < invalidRate) messages.push({ key: e.key, value: '{"eventType":"order.placed"' });
      byTopic.set(topicFor(e), messages);
    }
    if (byTopic.size === 0) return;
    await producer.sendBatch({
      topicMessages: [...byTopic].map(([topic, messages]) => ({ topic, messages })),
    });
    sent += batch.length;
  };

  await send(sim.seedInventory(start));
  let stopping = false;
  let stoppedOnce = false;
  const stop = () => {
    if (stoppedOnce) process.exit(130);
    stopping = stoppedOnce = true;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  // Poisson arrivals: exponential inter-arrival times with mean 1/rate.
  let nextOrderAt = start;
  let lastLog = start;
  while (!stopping && (durationMs === 0 || Date.now() - start < durationMs)) {
    const now = Date.now();
    const batch: Envelope[] = [];
    while (nextOrderAt <= now) {
      batch.push(...sim.placeOrder(nextOrderAt));
      nextOrderAt += (-Math.log(1 - rand()) / rate) * 1000;
    }
    batch.push(...sim.due(now));
    await send(batch);
    if (now - lastLog >= 5000) {
      console.log(`sent ${sent} events`);
      lastLog = now;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  // Let in-flight orders finish their lifecycle (ship/cancel) in real time.
  for (let next = sim.nextDueAt(); next !== undefined && !stopping; next = sim.nextDueAt()) {
    await new Promise((r) => setTimeout(r, Math.max(0, next - Date.now())));
    await send(sim.due(Date.now()));
  }
  await producer.disconnect();
  console.log(`done, sent ${sent} events (seed ${seed})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
