import type { EventSourceFactory, EventSourceLike } from './useLiveSnapshot';

/** Where the numbers on the page come from. */
export type DataMode = 'live' | 'simulated';

export interface ModeStore {
  get(): DataMode;
  subscribe(listener: () => void): () => void;
}

export interface FallbackOptions {
  /** Opens the real stream (the browser's EventSource in production). */
  live: EventSourceFactory;
  /** Opens the in-browser simulator. */
  fallback: EventSourceFactory;
  /** How long the live backend gets to deliver its first snapshot. */
  timeoutMs?: number;
}

/**
 * Prefers the live backend and falls back to the simulator when it can't be reached.
 *
 * The public site points at a backend on free-tier hosting, which can be down for maintenance or
 * out of quota. A visitor should still see a working dashboard, and be told honestly which one
 * it is. The decision is made once per page: if the backend delivers a snapshot within the
 * timeout the page stays live (and later drops are ordinary reconnects); if it errors or stays
 * silent first, the page switches to the simulator for the rest of the visit.
 */
export function createFallbackEventSourceFactory(opts: FallbackOptions): {
  factory: EventSourceFactory;
  mode: ModeStore;
} {
  let mode: DataMode = 'live';
  const listeners = new Set<() => void>();
  const setMode = (m: DataMode) => {
    if (m === mode) return;
    mode = m;
    for (const l of listeners) l();
  };

  const store: ModeStore = {
    get: () => mode,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };

  const factory: EventSourceFactory = (url) =>
    mode === 'simulated'
      ? opts.fallback(url)
      : new FallbackEventSource(url, opts, () => setMode('simulated'));

  return { factory, mode: store };
}

class FallbackEventSource implements EventSourceLike {
  onopen: ((ev: Event) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  private readonly listeners: Array<(ev: MessageEvent<string>) => void> = [];
  private inner: EventSourceLike;
  private receivedData = false;
  private switched = false;
  private closed = false;
  private readonly timer: ReturnType<typeof setTimeout>;

  constructor(
    private readonly url: string,
    private readonly opts: FallbackOptions,
    private readonly onFallback: () => void,
  ) {
    this.inner = this.wire(opts.live(url));
    this.timer = setTimeout(() => {
      if (!this.receivedData) this.switchToFallback();
    }, opts.timeoutMs ?? 8_000);
  }

  get readyState(): number {
    return this.inner.readyState;
  }

  addEventListener(type: string, listener: (ev: MessageEvent<string>) => void): void {
    if (type === 'snapshot') this.listeners.push(listener);
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.inner.close();
  }

  private wire(source: EventSourceLike): EventSourceLike {
    source.onopen = (ev) => this.onopen?.(ev);
    source.onerror = (ev) => {
      // Before the first snapshot an error means the backend is unreachable: don't make the
      // visitor watch a spinner while the browser retries, show the simulator instead.
      if (!this.receivedData && !this.switched) this.switchToFallback();
      else this.onerror?.(ev);
    };
    source.addEventListener('snapshot', (ev) => {
      this.receivedData = true;
      for (const l of this.listeners) l(ev);
    });
    return source;
  }

  private switchToFallback(): void {
    if (this.switched || this.closed) return;
    this.switched = true;
    clearTimeout(this.timer);
    this.inner.close();
    this.onFallback();
    this.inner = this.wire(this.opts.fallback(this.url));
  }
}
