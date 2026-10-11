import { mkdtempSync, writeFileSync } from 'node:fs';
import { get, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DashboardSnapshot } from '@orderflow/contracts';
import { buildServer, corsPolicy, type ServerDeps } from '../src/http/server';
import { createMetrics } from '../src/metrics';
import { Projection } from '../src/projection/projection';
import { confirmed, level, placed } from './fixtures';

function setup(overrides: Partial<ServerDeps> = {}) {
  const projection = new Projection({ lowStockThreshold: 5 });
  const state = { caughtUp: true, healthy: true };
  const app = buildServer({
    projection,
    metrics: createMetrics(),
    caughtUp: () => state.caughtUp,
    healthy: () => state.healthy,
    streamIntervalMs: 20,
    // Fixed clock: the stream version includes the minute, so a real rollover could add a push.
    now: () => new Date('2026-10-06T10:00:30Z'),
    ...overrides,
  });
  return { app, projection, state };
}

describe('probes', () => {
  it('reports ready only once caught up', async () => {
    const { app, state } = setup();
    state.caughtUp = false;
    expect((await app.inject('/readyz')).statusCode).toBe(503);
    state.caughtUp = true;
    expect((await app.inject('/readyz')).json()).toEqual({ status: 'ready' });
  });

  it('fails liveness when the consumer is dead', async () => {
    const { app, state } = setup();
    expect((await app.inject('/healthz')).statusCode).toBe(200);
    state.healthy = false;
    expect((await app.inject('/healthz')).statusCode).toBe(503);
  });

  it('exposes Prometheus metrics', async () => {
    const { app } = setup();
    const res = await app.inject('/metrics');
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.body).toContain('orderflow_dashboard_caught_up');
  });
});

describe('REST API', () => {
  it('serves the snapshot', async () => {
    const { app, projection } = setup();
    projection.apply(placed('A'));
    const body = (await app.inject('/api/snapshot')).json<DashboardSnapshot>();
    expect(body.orders.total).toBe(1);
    expect(body.caughtUp).toBe(true);
  });

  it('filters and limits orders, newest first', async () => {
    const { app, projection } = setup();
    projection.apply(placed('A', 0));
    projection.apply(placed('B', 10));
    projection.apply(placed('C', 20));
    projection.apply(confirmed('A', 30));

    const all = (await app.inject('/api/orders?limit=2')).json();
    expect(all.orders.map((o: { orderId: string }) => o.orderId)).toEqual(['A', 'C']);
    const placedOnly = (await app.inject('/api/orders?status=placed')).json();
    expect(placedOnly.orders.map((o: { orderId: string }) => o.orderId)).toEqual(['C', 'B']);
  });

  it.each(['/api/orders?status=lost', '/api/orders?limit=0', '/api/orders?limit=9999', '/api/inventory?lowStock=yes'])(
    'rejects bad query %s with 400',
    async (url) => {
      const { app } = setup();
      const res = await app.inject(url);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toEqual(expect.any(String));
    },
  );

  it('returns one order or 404', async () => {
    const { app, projection } = setup();
    projection.apply(placed('ORD 1'));
    expect((await app.inject('/api/orders/ORD%201')).json().orderId).toBe('ORD 1');
    expect((await app.inject('/api/orders/nope')).statusCode).toBe(404);
  });

  it('lists inventory, optionally only low stock', async () => {
    const { app, projection } = setup();
    projection.apply(level('SKU-1', 20, 0));
    projection.apply(level('SKU-2', 2, 0));
    expect((await app.inject('/api/inventory')).json().inventory).toHaveLength(2);
    const low = (await app.inject('/api/inventory?lowStock=true')).json().inventory;
    expect(low.map((i: { sku: string }) => i.sku)).toEqual(['SKU-2']);
  });
});

describe('live stream (SSE)', () => {
  it('sends a snapshot on connect, pushes changes, and stays quiet when nothing changes', async () => {
    const { app, projection } = setup();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    const client = await openStream(`http://127.0.0.1:${port}/api/stream`);
    try {
      expect(client.response.headers['content-type']).toBe('text/event-stream; charset=utf-8');
      const first = await client.next();
      expect(first.orders.total).toBe(0);

      // A burst of events is coalesced into a single push.
      projection.apply(placed('A'));
      projection.apply(placed('B'));
      projection.apply(placed('C'));
      const second = await client.next();
      expect(second.orders.total).toBe(3);
      await delay(100);
      expect(client.pending()).toBe(0);
    } finally {
      client.close();
      await app.close();
    }
  });

  it('tracks connected clients', async () => {
    const { app } = setup();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    const a = await openStream(`http://127.0.0.1:${port}/api/stream`);
    await a.next();
    expect(app.snapshotStream.clientCount).toBe(1);
    a.close();
    await waitFor(() => app.snapshotStream.clientCount === 0);
    await app.close();
  });
});

describe('CORS', () => {
  it('lets listed origins read the API and the stream', async () => {
    const { app } = setup({ corsOrigins: ['https://logos.vercel.app'] });
    const ok = await app.inject({ url: '/api/snapshot', headers: { origin: 'https://logos.vercel.app' } });
    expect(ok.headers['access-control-allow-origin']).toBe('https://logos.vercel.app');
    expect(ok.headers.vary).toMatch(/Origin/);
    const other = await app.inject({ url: '/api/snapshot', headers: { origin: 'https://evil.example' } });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
    // Operator endpoints never get CORS headers.
    const probe = await app.inject({ url: '/healthz', headers: { origin: 'https://logos.vercel.app' } });
    expect(probe.headers['access-control-allow-origin']).toBeUndefined();

    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    const client = await openStream(`http://127.0.0.1:${port}/api/stream`, { origin: 'https://logos.vercel.app' });
    try {
      expect(client.response.headers['access-control-allow-origin']).toBe('https://logos.vercel.app');
      await client.next();
    } finally {
      client.close();
      await app.close();
    }
  });

  it('sends nothing by default, and * when any origin is allowed', () => {
    expect(corsPolicy([])('https://a.dev')).toBeNull();
    expect(corsPolicy(['*'])('https://a.dev')).toBe('*');
    expect(corsPolicy(['https://a.dev/'])('https://a.dev')).toBe('https://a.dev');
    expect(corsPolicy(['https://a.dev'])(undefined)).toBeNull();
  });
});

describe('static web app', () => {
  it('serves index.html for client-side routes but 404s unknown API paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'web-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Dashboard</title>');
    const { app } = setup({ staticDir: dir });
    expect((await app.inject('/')).body).toContain('<title>Dashboard</title>');
    expect((await app.inject('/orders/ORD-1')).body).toContain('<title>Dashboard</title>');
    expect((await app.inject('/api/nope')).statusCode).toBe(404);
  });

  it('fails fast on a missing directory', () => {
    expect(() => setup({ staticDir: '/does/not/exist' })).toThrow(/STATIC_DIR/);
  });
});

async function openStream(url: string, headers: Record<string, string> = {}) {
  const frames: DashboardSnapshot[] = [];
  const waiters: Array<(s: DashboardSnapshot) => void> = [];
  const response = await new Promise<IncomingMessage>((resolve, reject) =>
    get(url, { headers }, resolve).on('error', reject),
  );
  let buffer = '';
  response.setEncoding('utf8');
  response.on('data', (chunk: string) => {
    buffer += chunk;
    let i: number;
    while ((i = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      const data = raw.split('\n').find((l) => l.startsWith('data: '));
      if (!raw.includes('event: snapshot') || !data) continue;
      const snap = JSON.parse(data.slice(6)) as DashboardSnapshot;
      const w = waiters.shift();
      if (w) w(snap);
      else frames.push(snap);
    }
  });
  return {
    response,
    next: () =>
      new Promise<DashboardSnapshot>((resolve, reject) => {
        const f = frames.shift();
        if (f) return resolve(f);
        const t = setTimeout(() => reject(new Error('no snapshot within 2s')), 2000);
        waiters.push((s) => {
          clearTimeout(t);
          resolve(s);
        });
      }),
    pending: () => frames.length,
    close: () => response.destroy(),
  };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, timeoutMs = 2000) {
  const end = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > end) throw new Error('condition not met');
    await delay(10);
  }
}
