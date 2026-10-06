import { act, renderHook } from '@testing-library/react';
import { useLiveSnapshot } from '../src/hooks/useLiveSnapshot';
import { FakeEventSource, snapshot } from './fixtures';

beforeEach(() => {
  FakeEventSource.instances = [];
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

it('goes from connecting to live and exposes each snapshot', () => {
  const { result } = renderHook(() => useLiveSnapshot('/api/stream', FakeEventSource.factory));
  expect(result.current).toMatchObject({ connection: 'connecting', snapshot: null });
  const es = FakeEventSource.latest();
  expect(es.url).toBe('/api/stream');

  act(() => es.open());
  expect(result.current.connection).toBe('live');

  act(() => es.emit('snapshot', snapshot({ caughtUp: false })));
  expect(result.current.snapshot?.caughtUp).toBe(false);
  expect(result.current.receivedAt).toBeInstanceOf(Date);
});

it('ignores a malformed frame instead of crashing', () => {
  const { result } = renderHook(() => useLiveSnapshot('/s', FakeEventSource.factory));
  act(() => FakeEventSource.latest().emit('snapshot', '{oops'));
  expect(result.current.snapshot).toBeNull();
});

it('lets the browser retry transient errors on its own', () => {
  const { result } = renderHook(() => useLiveSnapshot('/s', FakeEventSource.factory));
  act(() => FakeEventSource.latest().fail(false));
  expect(result.current.connection).toBe('reconnecting');
  act(() => jest.advanceTimersByTime(60_000));
  expect(FakeEventSource.instances).toHaveLength(1);
});

it('re-opens with exponential backoff after the browser gives up', () => {
  renderHook(() => useLiveSnapshot('/s', FakeEventSource.factory));
  act(() => FakeEventSource.latest().fail(true));
  act(() => jest.advanceTimersByTime(999));
  expect(FakeEventSource.instances).toHaveLength(1);
  act(() => jest.advanceTimersByTime(1));
  expect(FakeEventSource.instances).toHaveLength(2);

  act(() => FakeEventSource.latest().fail(true));
  act(() => jest.advanceTimersByTime(1_999));
  expect(FakeEventSource.instances).toHaveLength(2);
  act(() => jest.advanceTimersByTime(1));
  expect(FakeEventSource.instances).toHaveLength(3);

  // A successful open resets the backoff.
  act(() => FakeEventSource.latest().open());
  act(() => FakeEventSource.latest().fail(true));
  act(() => jest.advanceTimersByTime(1_000));
  expect(FakeEventSource.instances).toHaveLength(4);
});

it('closes the stream and cancels retries on unmount', () => {
  const { unmount } = renderHook(() => useLiveSnapshot('/s', FakeEventSource.factory));
  const es = FakeEventSource.latest();
  act(() => es.fail(true));
  unmount();
  act(() => jest.advanceTimersByTime(60_000));
  expect(es.closed).toBe(true);
  expect(FakeEventSource.instances).toHaveLength(1);
});
