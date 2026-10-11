import { act, render, screen } from '@testing-library/react';
import { App } from '../src/App';
import { createFallbackEventSourceFactory } from '../src/hooks/fallback-source';
import { FakeEventSource, snapshot } from './fixtures';

beforeEach(() => {
  FakeEventSource.instances = [];
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

/** Two fake sources, so the test can tell the live backend from the simulator. */
function setup(timeoutMs = 5_000) {
  const live: FakeEventSource[] = [];
  const simulated: FakeEventSource[] = [];
  const { factory, mode } = createFallbackEventSourceFactory({
    live: (url) => {
      const es = new FakeEventSource(url);
      live.push(es);
      return es;
    },
    fallback: (url) => {
      const es = new FakeEventSource(url);
      simulated.push(es);
      return es;
    },
    timeoutMs,
  });
  return { factory, mode, live, simulated };
}

it('stays live when the backend answers in time', () => {
  const { factory, mode, live, simulated } = setup();
  const es = factory('https://api.example/api/stream');
  const frames: string[] = [];
  es.addEventListener('snapshot', (ev) => frames.push(ev.data));
  live[0]!.open();
  live[0]!.emit('snapshot', snapshot());
  jest.advanceTimersByTime(60_000);
  expect(frames).toHaveLength(1);
  expect(simulated).toHaveLength(0);
  expect(mode.get()).toBe('live');
  expect(live[0]!.url).toBe('https://api.example/api/stream');
});

it('switches to the simulator at once when the backend is unreachable', () => {
  const { factory, mode, live, simulated } = setup();
  const changed = jest.fn();
  mode.subscribe(changed);
  const es = factory('/api/stream');
  const frames: string[] = [];
  es.addEventListener('snapshot', (ev) => frames.push(ev.data));

  live[0]!.fail(false);
  expect(live[0]!.closed).toBe(true);
  expect(mode.get()).toBe('simulated');
  expect(changed).toHaveBeenCalledTimes(1);

  simulated[0]!.open();
  simulated[0]!.emit('snapshot', snapshot());
  expect(frames).toHaveLength(1);
  // Later connections go straight to the simulator.
  factory('/api/stream');
  expect(live).toHaveLength(1);
  expect(simulated).toHaveLength(2);
});

it('switches when the backend stays silent past the timeout', () => {
  const { factory, mode, live, simulated } = setup(5_000);
  factory('/api/stream');
  live[0]!.open();
  jest.advanceTimersByTime(4_999);
  expect(mode.get()).toBe('live');
  jest.advanceTimersByTime(1);
  expect(mode.get()).toBe('simulated');
  expect(simulated).toHaveLength(1);
});

it('treats errors after the first snapshot as ordinary reconnects', () => {
  const { factory, mode, live, simulated } = setup();
  const es = factory('/api/stream');
  const onerror = jest.fn();
  es.onerror = onerror;
  live[0]!.emit('snapshot', snapshot());
  live[0]!.fail(false);
  expect(onerror).toHaveBeenCalled();
  expect(mode.get()).toBe('live');
  expect(simulated).toHaveLength(0);
});

it('does nothing after it is closed', () => {
  const { factory, mode, live, simulated } = setup();
  const es = factory('/api/stream');
  es.close();
  expect(live[0]!.closed).toBe(true);
  jest.advanceTimersByTime(60_000);
  expect(mode.get()).toBe('live');
  expect(simulated).toHaveLength(0);
});

it('tells the visitor which data they are looking at', () => {
  const { factory, mode, live, simulated } = setup();
  render(<App createEventSource={factory} mode={mode} streamUrl="https://api.example/api/stream" />);
  act(() => {
    live[0]!.open();
    live[0]!.emit('snapshot', snapshot());
  });
  expect(screen.getByText(/^Live\. Every number/)).toBeInTheDocument();
  expect(screen.getByText('Orders and inventory, straight from Kafka')).toBeInTheDocument();
  expect(screen.getByLabelText('Consumer health')).toHaveTextContent('dead-lettered');

  // A second page whose backend is down.
  FakeEventSource.instances = [];
  const down = setup();
  render(<App createEventSource={down.factory} mode={down.mode} />);
  act(() => down.live[0]!.fail(true));
  act(() => {
    down.simulated[0]!.open();
    down.simulated[0]!.emit('snapshot', snapshot());
  });
  expect(screen.getByText(/live backend can't be reached/)).toBeInTheDocument();
  expect(simulated).toHaveLength(0);
});
