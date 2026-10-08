import { act, render, screen } from '@testing-library/react';
import type { DashboardSnapshot } from '@orderflow/contracts';
import { App } from '../src/App';
import { DemoPipeline, createDemoEventSourceFactory } from '../src/demo/demo-stream';

const T0 = Date.parse('2026-10-07T12:00:00Z');

describe('DemoPipeline', () => {
  it('backfills a consistent history through contract validation and the projection', () => {
    const p = new DemoPipeline({ seed: 7, now: () => T0, backfillMinutes: 10 });
    p.advanceTo(T0);
    const s = p.snapshot();

    expect(s.caughtUp).toBe(true);
    expect(s.inventory.skus).toBe(12);
    // ~1 order/s for 10 minutes.
    expect(s.orders.total).toBeGreaterThan(450);
    expect(s.orders.total).toBeLessThan(750);
    const { placed, confirmed, rejected, cancelled } = s.orders.byStatus;
    expect(placed + confirmed + rejected + cancelled).toBe(s.orders.total);
    expect(confirmed).toBeGreaterThan(0);
    expect(s.orders.revenueCents).toBeGreaterThan(0);
    // Redeliveries are deduplicated and malformed messages counted, as the Kafka consumer does.
    expect(s.consumer.duplicates).toBeGreaterThan(0);
    expect(s.consumer.invalid).toBeGreaterThan(0);
    expect(s.consumer.ignoredTransitions).toBe(0);
    expect(s.throughput.some((pt) => pt.orders > 0)).toBe(true);
  });

  it('is reproducible for a seed', () => {
    const run = () => {
      const p = new DemoPipeline({ seed: 3, now: () => T0, backfillMinutes: 2 });
      p.advanceTo(T0 + 5_000);
      return p.snapshot();
    };
    expect(run()).toEqual(run());
  });

  it('keeps flowing as time advances', () => {
    const p = new DemoPipeline({ seed: 1, now: () => T0, backfillMinutes: 1 });
    p.advanceTo(T0);
    const before = p.snapshot().consumer.processed;
    p.advanceTo(T0 + 30_000);
    expect(p.snapshot().consumer.processed).toBeGreaterThan(before);
  });
});

describe('demo event source', () => {
  beforeEach(() => jest.useFakeTimers({ now: T0 }));
  afterEach(() => jest.useRealTimers());

  it('opens, pushes changed snapshots, and stops when closed', () => {
    const factory = createDemoEventSourceFactory({ seed: 5, backfillMinutes: 1 });
    const es = factory('/api/stream');
    const opened = jest.fn();
    const frames: DashboardSnapshot[] = [];
    es.onopen = opened;
    es.addEventListener('snapshot', (ev) => frames.push(JSON.parse(ev.data) as DashboardSnapshot));

    jest.advanceTimersByTime(0);
    expect(opened).toHaveBeenCalled();
    expect(es.readyState).toBe(1);
    expect(frames).toHaveLength(1);

    jest.advanceTimersByTime(10_000);
    expect(frames.length).toBeGreaterThan(1);
    expect(frames.at(-1)!.consumer.processed).toBeGreaterThan(frames[0]!.consumer.processed);

    es.close();
    const count = frames.length;
    jest.advanceTimersByTime(10_000);
    expect(frames).toHaveLength(count);
  });

  it('drives the real dashboard with a demo banner', () => {
    const factory = createDemoEventSourceFactory({ seed: 9, backfillMinutes: 5 });
    render(<App demo createEventSource={factory} />);
    act(() => jest.advanceTimersByTime(0));

    expect(screen.getByText(/Public demo/)).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Events per minute' })).toBeInTheDocument();
    expect(screen.getByLabelText('Consumer health')).toHaveTextContent('duplicates ignored');
  });
});
