import { createMessageHandler, type DeadLetter } from '../src/kafka/handler';
import { CatchUpTracker } from '../src/kafka/catch-up';
import { deadLetterHeaders } from '../src/kafka/consumer';
import { createMetrics } from '../src/metrics';
import { Projection } from '../src/projection/projection';
import { placed } from './fixtures';

function setup(withDlq = true) {
  const projection = new Projection({ lowStockThreshold: 5 });
  const metrics = createMetrics();
  const tracker = new CatchUpTracker([{ topic: 'orders.events.v1', partition: 0, low: '0', high: '2' }]);
  const letters: DeadLetter[] = [];
  const warn = jest.fn();
  const handle = createMessageHandler({
    projection,
    metrics,
    tracker: () => tracker,
    deadLetter: withDlq ? async (l) => void letters.push(l) : undefined,
    log: { warn },
  });
  const msg = (offset: string, value: string | null) => ({
    topic: 'orders.events.v1',
    partition: 0,
    message: { offset, key: Buffer.from('ORD-1'), value: value == null ? null : Buffer.from(value) },
  });
  return { projection, metrics, tracker, letters, warn, handle, msg };
}

it('applies a valid event and advances catch-up', async () => {
  const { handle, msg, projection, tracker, metrics } = setup();
  await handle(msg('0', JSON.stringify(placed('ORD-1'))));
  expect(projection.getOrder('ORD-1')?.status).toBe('placed');
  expect(tracker.caughtUp).toBe(false);

  const dup = placed('ORD-1');
  await handle(msg('1', JSON.stringify(dup)));
  expect(tracker.caughtUp).toBe(true);
  const text = await metrics.registry.metrics();
  expect(text).toContain('orderflow_dashboard_events_total{event_type="order.placed",outcome="applied"} 2');
});

it('dead-letters a poison message, keeps going, and still advances catch-up', async () => {
  const { handle, msg, projection, tracker, letters, warn, metrics } = setup();
  await handle(msg('0', '{not json'));
  await handle(msg('1', JSON.stringify(placed('ORD-2'))));

  expect(letters).toHaveLength(1);
  expect(letters[0]).toMatchObject({ sourceTopic: 'orders.events.v1', partition: 0, offset: '0' });
  expect(letters[0]!.error).toMatch(/invalid JSON/);
  expect(letters[0]!.value?.toString()).toBe('{not json');
  expect(warn).toHaveBeenCalledTimes(1);
  expect(projection.snapshot(true).consumer).toMatchObject({ invalid: 1, processed: 1 });
  expect(tracker.caughtUp).toBe(true);
  expect(await metrics.registry.metrics()).toContain(
    'orderflow_dashboard_dead_lettered_total{topic="orders.events.v1"} 1',
  );
});

it('skips unknown event types and newer schema versions without dead-lettering them', async () => {
  const { handle, msg, projection, letters, warn, tracker } = setup();
  const known = placed('ORD-1');
  await handle(msg('0', JSON.stringify({ ...known, eventType: 'order.shipped' })));
  await handle(msg('1', JSON.stringify({ ...known, schemaVersion: 2 })));
  expect(projection.snapshot(true).consumer).toMatchObject({ unsupported: 2, invalid: 0, processed: 0 });
  expect(letters).toHaveLength(0);
  expect(warn).not.toHaveBeenCalled();
  expect(tracker.caughtUp).toBe(true);
});

it('labels dead letters with the platform dlt-* headers', () => {
  const headers = deadLetterHeaders(
    { sourceTopic: 'orders.events.v1', partition: 2, offset: '41', key: null, value: null, error: 'x'.repeat(2000) },
    'orderflow-dashboard',
  );
  expect(headers).toMatchObject({
    'dlt-source-topic': 'orders.events.v1',
    'dlt-source-partition': '2',
    'dlt-source-offset': '41',
    'dlt-attempts': '1',
    'dlt-consumer': 'orderflow-dashboard',
  });
  expect(headers['dlt-error']).toMatch(/^ContractValidation: x+$/);
  expect(headers['dlt-error']!.length).toBe(1000);
});

it('skips a tombstone without a dead-letter topic configured', async () => {
  const { handle, msg, projection } = setup(false);
  await handle(msg('0', null));
  expect(projection.snapshot(true).consumer.invalid).toBe(1);
});

it('does not advance catch-up if dead-lettering fails, so the message is retried', async () => {
  const projection = new Projection({ lowStockThreshold: 5 });
  const tracker = new CatchUpTracker([{ topic: 't', partition: 0, low: '0', high: '1' }]);
  const handle = createMessageHandler({
    projection,
    metrics: createMetrics(),
    tracker: () => tracker,
    deadLetter: async () => {
      throw new Error('broker unavailable');
    },
    log: { warn: () => {} },
  });
  await expect(
    handle({ topic: 't', partition: 0, message: { offset: '0', key: null, value: Buffer.from('x') } }),
  ).rejects.toThrow('broker unavailable');
  expect(tracker.caughtUp).toBe(false);
});
