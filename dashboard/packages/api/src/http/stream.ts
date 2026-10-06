import type { ServerResponse } from 'node:http';
import type { DashboardSnapshot } from '@orderflow/contracts';

export interface StreamSource {
  /** Changes whenever the snapshot would change. */
  version: () => string;
  snapshot: () => DashboardSnapshot;
}

/**
 * Server-Sent Events fan-out for the live dashboard.
 *
 * Pushes are coalesced: at most one snapshot per `intervalMs`, and only when the source's
 * version changed. Under a burst of thousands of events per second clients still receive a
 * bounded number of messages, and the snapshot is serialized once per tick, not per client.
 */
export class SnapshotStream {
  /** Each client with the version of the last snapshot it was sent. */
  private readonly clients = new Map<ServerResponse, string>();
  private timer: NodeJS.Timeout | undefined;
  private heartbeat: NodeJS.Timeout | undefined;

  constructor(
    private readonly source: StreamSource,
    private readonly opts: {
      intervalMs: number;
      heartbeatMs?: number;
      onClientCountChange?: (count: number) => void;
    },
  ) {}

  get clientCount(): number {
    return this.clients.size;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.opts.intervalMs);
    this.heartbeat = setInterval(() => this.writeAll(': keep-alive\n\n'), this.opts.heartbeatMs ?? 15_000);
    this.timer.unref();
    this.heartbeat.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    clearInterval(this.heartbeat);
    this.timer = this.heartbeat = undefined;
    for (const res of this.clients.keys()) res.end();
    this.clients.clear();
    this.opts.onClientCountChange?.(0);
  }

  /** Takes over a raw response, sends the current snapshot, and keeps it for future pushes. */
  attach(res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Stops nginx-style proxies from buffering the stream.
      'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const version = this.source.version();
    res.write(frame(this.source.snapshot()));
    this.clients.set(res, version);
    this.opts.onClientCountChange?.(this.clients.size);
    res.on('close', () => {
      this.clients.delete(res);
      this.opts.onClientCountChange?.(this.clients.size);
    });
  }

  /** Pushes a snapshot to every client that hasn't seen the current version. */
  tick(): void {
    const version = this.source.version();
    let chunk: string | undefined;
    for (const [res, seen] of this.clients) {
      if (seen === version) continue;
      // Serialized at most once per tick, however many clients there are.
      chunk ??= frame(this.source.snapshot());
      res.write(chunk);
      this.clients.set(res, version);
    }
  }

  private writeAll(chunk: string): void {
    for (const res of this.clients.keys()) res.write(chunk);
  }
}

function frame(snapshot: DashboardSnapshot): string {
  return `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`;
}
