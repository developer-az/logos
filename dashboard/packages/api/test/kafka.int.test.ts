/**
 * Runs the real consumer against a real Kafka broker.
 *
 *   docker compose up -d kafka      # or any broker
 *   KAFKA_BROKERS=localhost:9092 npm run test:integration
 *
 * Skipped when KAFKA_BROKERS is not set, so `npm test` works without a broker.
 */
import { randomUUID } from 'node:crypto';
import { Kafka, logLevel, type KafkaMessage } from 'kafkajs';
import { TOPICS, deadLetterTopicFor } from '@orderflow/contracts';
import { loadConfig } from '../src/config';
import { startConsumer, type RunningConsumer } from '../src/kafka/consumer';
import { createMetrics } from '../src/metrics';
import { Projection } from '../src/projection/projection';
import { OrderFlowSimulator, type Envelope } from '../src/simulator/generator';

const brokers = process.env.KAFKA_BROKERS;
const describeKafka = brokers ? describe : describe.skip;
jest.setTimeout(60_000);

describeKafka('consumer against a live broker', () => {
  const run = randomUUID().slice(0, 8);
  const ordersTopic = `it-${run}-${TOPICS.orders}`;
  const inventoryTopic = `it-${run}-${TOPICS.inventory}`;
  const dlqTopic = deadLetterTopicFor(ordersTopic);
  const kafka = new Kafka({ clientId: 'it', brokers: brokers!.split(','), logLevel: logLevel.NOTHING });
  const producer = kafka.producer({ idempotent: true });
  const sim = new OrderFlowSimulator({ seed: 99, skus: 6 });
  const T0 = Date.now() - 60_000;
  let consumer: RunningConsumer | undefined;
  const log = { info: () => {}, warn: () => {}, error: () => {} };

  const publish = async (batch: Envelope[], extra: { topic: string; value: string }[] = []) => {
    const topic = (e: Envelope) => (e.topic === TOPICS.orders ? ordersTopic : inventoryTopic);
    for (const e of batch) {
      await producer.send({ topic: topic(e), messages: [{ key: e.key, value: JSON.stringify(e.event) }] });
    }
    for (const x of extra) await producer.send({ topic: x.topic, messages: [{ key: 'bad', value: x.value }] });
  };

  beforeAll(async () => {
    const admin = kafka.admin();
    await admin.connect();
    await admin.createTopics({
      waitForLeaders: true,
      // Mirrors the services' provisioning: each topic plus `<topic>.dlt`.
      topics: [ordersTopic, inventoryTopic, dlqTopic, deadLetterTopicFor(inventoryTopic)].map((topic) => ({
        topic,
        numPartitions: 3,
      })),
    });
    await admin.disconnect();
    await producer.connect();
  });

  afterAll(async () => {
    await consumer?.stop();
    await producer.disconnect();
    const admin = kafka.admin();
    await admin.connect();
    await admin
      .deleteTopics({ topics: [ordersTopic, inventoryTopic, dlqTopic, deadLetterTopicFor(inventoryTopic)] })
      .catch(() => {});
    await admin.disconnect();
  });

  it('replays history, becomes ready, then follows live traffic', async () => {
    // History written before the dashboard starts, including a redelivered event, a poison
    // message, and an event type this dashboard doesn't know (must be skipped, not dead-lettered).
    const history = [...sim.seedInventory(T0)];
    for (let i = 0; i < 40; i++) history.push(...sim.placeOrder(T0 + i * 100));
    history.push(...sim.due(T0 + 2_000));
    const unknownType = JSON.stringify({ ...history[1]!.event, eventId: randomUUID(), eventType: 'order.shipped' });
    await publish(
      [...history, history[10]!],
      [
        { topic: ordersTopic, value: '{"eventType":"order.placed"' },
        { topic: ordersTopic, value: unknownType },
      ],
    );

    const projection = new Projection({ lowStockThreshold: 5 });
    const config = loadConfig({
      KAFKA_BROKERS: brokers,
      KAFKA_GROUP_PREFIX: `it-${run}`,
      ORDERS_TOPIC: ordersTopic,
      INVENTORY_TOPIC: inventoryTopic,
    });
    consumer = await startConsumer({ config: config.kafka, projection, metrics: createMetrics(), log });

    await waitFor(() => consumer!.tracker?.caughtUp === true);
    const replayed = projection.snapshot(true);
    expect(replayed.orders.total).toBe(40);
    expect(replayed.consumer).toMatchObject({
      processed: history.length,
      duplicates: 1,
      invalid: 1,
      unsupported: 1,
    });

    // Live traffic after catch-up: the rest of every order's lifecycle.
    const live = sim.due(Number.MAX_SAFE_INTEGER);
    expect(live.length).toBeGreaterThan(0);
    await publish(live);
    await waitFor(() => projection.snapshot(true).consumer.processed === history.length + live.length);

    const inventory = projection
      .listInventory()
      .map(({ sku, onHand, reserved, available, version }) => ({ sku, onHand, reserved, available, version }));
    expect(inventory).toEqual(sim.stockLevels());
    expect(projection.snapshot(true).orders.byStatus.placed).toBe(0);

    const dead = await readOne(kafka, dlqTopic);
    expect(dead.value?.toString()).toBe('{"eventType":"order.placed"');
    expect(dead.headers?.['dlt-source-topic']?.toString()).toBe(ordersTopic);
    expect(dead.headers?.['dlt-error']?.toString()).toMatch(/invalid JSON/);
  });
});

async function readOne(kafka: Kafka, topic: string): Promise<KafkaMessage> {
  const c = kafka.consumer({ groupId: `it-reader-${randomUUID()}` });
  await c.connect();
  await c.subscribe({ topic, fromBeginning: true });
  try {
    return await new Promise<KafkaMessage>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`nothing on ${topic}`)), 20_000);
      void c.run({
        eachMessage: async ({ message }) => {
          clearTimeout(t);
          resolve(message);
        },
      });
    });
  } finally {
    await c.disconnect();
  }
}

async function waitFor(cond: () => boolean, timeoutMs = 30_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 100));
  }
}
