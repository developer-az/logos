import { useEffect, useState } from 'react';
import type { DashboardSnapshot } from '@orderflow/contracts';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting';

/** The parts of EventSource the hook uses, so tests can supply a fake. */
export interface EventSourceLike {
  readyState: number;
  onopen: ((ev: Event) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
  addEventListener(type: string, listener: (ev: MessageEvent<string>) => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

const CLOSED = 2;
const defaultFactory: EventSourceFactory = (url) => new EventSource(url) as EventSourceLike;

export interface LiveSnapshot {
  snapshot: DashboardSnapshot | null;
  connection: ConnectionState;
  /** Client time the last snapshot arrived; drives "updated x ago". */
  receivedAt: Date | null;
}

/**
 * Subscribes to the API's server-sent snapshot stream. The browser's EventSource reconnects on
 * its own (the server sets `retry: 3000`); if it gives up (readyState CLOSED, e.g. after an HTTP
 * error), the hook re-opens it with backoff so a restarted API pod is picked up again.
 */
export function useLiveSnapshot(
  url = '/api/stream',
  createEventSource: EventSourceFactory = defaultFactory,
): LiveSnapshot {
  const [state, setState] = useState<LiveSnapshot>({
    snapshot: null,
    connection: 'connecting',
    receivedAt: null,
  });

  useEffect(() => {
    let source: EventSourceLike | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let disposed = false;

    const open = () => {
      source = createEventSource(url);
      source.onopen = () => {
        attempt = 0;
        setState((s) => ({ ...s, connection: 'live' }));
      };
      source.addEventListener('snapshot', (ev) => {
        let snapshot: DashboardSnapshot;
        try {
          snapshot = JSON.parse(ev.data) as DashboardSnapshot;
        } catch {
          return;
        }
        setState({ snapshot, connection: 'live', receivedAt: new Date() });
      });
      source.onerror = () => {
        setState((s) => ({ ...s, connection: 'reconnecting' }));
        if (source?.readyState === CLOSED && !disposed) {
          source.close();
          const delay = Math.min(30_000, 1_000 * 2 ** attempt++);
          retryTimer = setTimeout(open, delay);
        }
      };
    };
    open();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      source?.close();
    };
  }, [url, createEventSource]);

  return state;
}
