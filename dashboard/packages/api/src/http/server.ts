import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { ORDER_STATUSES } from '@orderflow/contracts';
import Fastify, { LogController, type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import { z } from 'zod';
import type { Metrics } from '../metrics';
import type { Projection } from '../projection/projection';
import { createRateLimiter } from './rate-limit';
import { SnapshotStream } from './stream';

export interface ServerDeps {
  projection: Projection;
  metrics: Metrics;
  /** Whether the read model has replayed the topics up to their startup end offsets. */
  caughtUp: () => boolean;
  /** False when the consumer has failed for good; liveness then reports unhealthy. */
  healthy: () => boolean;
  streamIntervalMs: number;
  staticDir?: string | null;
  /**
   * Browser origins allowed to read the read-only API cross-origin (a front end hosted
   * elsewhere, such as the Vercel build). `['*']` allows any origin. Empty: same origin only.
   */
  corsOrigins?: readonly string[];
  /** Base URLs of the services the dashboard forwards writes to; empty disables that path. */
  orderServiceUrl?: string | null;
  procurementServiceUrl?: string | null;
  catalogServiceUrl?: string | null;
  /** Writes allowed per client address per minute; 0 disables the limit. */
  writeRateLimitPerMinute?: number;
  /** Fastify trustProxy: a hop count as a string, true, or false (no proxy trusted). */
  trustProxy?: boolean | string;
  /** Injected in tests; the runtime uses global fetch. */
  fetch?: typeof fetch;
  logger?: FastifyServerOptions['logger'];
  now?: () => Date;
}

const QUIET_PATHS = new Set(['/healthz', '/readyz', '/metrics']);

const OrdersQuery = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
const InventoryQuery = z.object({
  lowStock: z.enum(['true', 'false']).optional(),
});

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.logger ?? false,
    trustProxy: deps.trustProxy ?? false,
    // Probes and scrapes arrive every few seconds; logging each would drown real requests.
    logController: new LogController({
      disableRequestLogging: (req) => QUIET_PATHS.has(req.url),
    }),
  });
  const now = deps.now ?? (() => new Date());

  const stream = new SnapshotStream(
    {
      // The throughput window slides with the clock, so the minute is part of the version.
      version: () =>
        `${deps.projection.version}:${deps.caughtUp()}:${Math.floor(now().getTime() / 60_000)}`,
      snapshot: () => deps.projection.snapshot(deps.caughtUp()),
    },
    {
      intervalMs: deps.streamIntervalMs,
      onClientCountChange: (n) => deps.metrics.streamClients.set(n),
    },
  );
  app.decorate('snapshotStream', stream);

  const allowOrigin = corsPolicy(deps.corsOrigins ?? []);
  const corsHeaders = (origin: string | undefined): Record<string, string> => {
    const allowed = allowOrigin(origin);
    return allowed ? { 'access-control-allow-origin': allowed, vary: 'Origin' } : {};
  };
  // Read routes are GETs; writes are POSTs that a browser preflights when the page is hosted
  // elsewhere. Both answer CORS here, without a plugin.
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const headers = corsHeaders(req.headers.origin);
    if (req.method === 'OPTIONS') {
      return reply.code(204).headers({
        ...headers,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, idempotency-key',
        'access-control-max-age': '600',
      }).send();
    }
    reply.headers(headers);
  });
  app.addHook('onReady', async () => stream.start());
  app.addHook('onClose', async () => stream.stop());

  app.get('/healthz', async (_req, reply) =>
    deps.healthy() ? { status: 'ok' } : reply.code(503).send({ status: 'consumer failed' }),
  );

  app.get('/readyz', async (_req, reply) =>
    deps.caughtUp()
      ? { status: 'ready' }
      : reply.code(503).send({ status: 'replaying', detail: 'consumer has not caught up yet' }),
  );

  app.get('/metrics', async (_req, reply) => {
    reply.header('content-type', deps.metrics.registry.contentType);
    return deps.metrics.registry.metrics();
  });

  app.get('/api/snapshot', async () => deps.projection.snapshot(deps.caughtUp()));

  app.get('/api/orders', async (req, reply) => {
    const q = OrdersQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: z.prettifyError(q.error) });
    return { orders: deps.projection.listOrders(q.data) };
  });

  app.get<{ Params: { orderId: string } }>('/api/orders/:orderId', async (req, reply) => {
    const order = deps.projection.getOrder(req.params.orderId);
    return order ?? reply.code(404).send({ error: 'order not found' });
  });

  app.get('/api/inventory', async (req, reply) => {
    const q = InventoryQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: z.prettifyError(q.error) });
    const all = deps.projection.listInventory();
    return { inventory: q.data.lowStock === 'true' ? all.filter((i) => i.lowStock) : all };
  });

  app.get('/api/stream', (req, reply) => {
    // Hijacked responses skip Fastify's header handling, so CORS goes in with the stream's own.
    reply.hijack();
    stream.attach(reply.raw, corsHeaders(req.headers.origin));
  });

  const fetchImpl = deps.fetch ?? fetch;

  // The public demo's writes are proxied to the services; without a limit one client could
  // create orders in a loop. Per-address, fixed window, in process.
  const writeLimit = deps.writeRateLimitPerMinute ?? 0;
  const limiter =
    writeLimit > 0
      ? createRateLimiter({ limit: writeLimit, windowMs: 60_000, now: () => now().getTime() })
      : null;
  const writeGuard = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!limiter) return;
    const result = limiter.take(req.ip);
    reply.headers({
      'x-ratelimit-limit': String(writeLimit),
      'x-ratelimit-remaining': String(result.remaining),
    });
    if (result.allowed) return;
    const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    return reply.header('retry-after', String(seconds)).code(429).send({
      error: `Too many writes from this address. Try again in ${seconds} s.`,
    });
  };

  // Writes go to the service that owns them. The dashboard never mutates the read model itself:
  // the event made by the service comes back through Kafka like every other change.
  app.post('/api/orders', { preHandler: writeGuard }, async (req, reply) => {
    if (!deps.orderServiceUrl) return reply.code(503).send({ error: 'ordering is not configured' });
    const key = req.headers['idempotency-key'];
    return forwardWrite(reply, fetchImpl, `${deps.orderServiceUrl}/orders`, req.body,
      typeof key === 'string' ? key : undefined);
  });

  app.post('/api/purchase-orders', { preHandler: writeGuard }, async (req, reply) => {
    if (!deps.procurementServiceUrl) return reply.code(503).send({ error: 'purchasing is not configured' });
    return forwardWrite(reply, fetchImpl, `${deps.procurementServiceUrl}/procurement/purchase-orders`, req.body);
  });

  // Read-through, so the page displays the price the order service will actually charge.
  app.get('/api/catalog', async (_req, reply) => {
    if (!deps.catalogServiceUrl) return reply.code(503).send({ error: 'catalog is not configured' });
    return forwardRead(reply, fetchImpl, `${deps.catalogServiceUrl}/catalog`);
  });

  if (deps.staticDir) {
    const root = resolve(deps.staticDir);
    if (!existsSync(root)) throw new Error(`STATIC_DIR does not exist: ${root}`);
    app.register(fastifyStatic, { root, wildcard: false });
    // Single-page app: unknown non-API paths get index.html.
    app.setNotFoundHandler((req, reply) =>
      req.method === 'GET' && !req.url.startsWith('/api/')
        ? reply.sendFile('index.html')
        : reply.code(404).send({ error: 'not found' }),
    );
  }

  return app;
}

/**
 * Forwards one write to the owning service and relays its status and body. A refused write is
 * passed through unchanged (the page can show the service's own validation message); only an
 * unreachable service becomes a 502.
 */
async function forwardWrite(
  reply: FastifyReply,
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
  idempotencyKey?: string,
): Promise<unknown> {
  return forward(reply, fetchImpl, url, 'POST', body ?? {},
    idempotencyKey ? { 'idempotency-key': idempotencyKey } : {});
}

/** Forwards one read the same way; the page only needs the body. */
async function forwardRead(reply: FastifyReply, fetchImpl: typeof fetch, url: string): Promise<unknown> {
  return forward(reply, fetchImpl, url, 'GET', undefined, {});
}

async function forward(
  reply: FastifyReply,
  fetchImpl: typeof fetch,
  url: string,
  method: 'GET' | 'POST',
  body: unknown,
  extraHeaders: Record<string, string>,
): Promise<unknown> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (body !== undefined) headers['content-type'] = 'application/json';
  try {
    const res = await fetchImpl(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(5_000),
    });
    const text = await res.text();
    reply
      .code(res.status)
      .header('content-type', res.headers.get('content-type') ?? 'application/json');
    return text ? reply.send(text) : reply.send();
  } catch (err) {
    reply.log.warn({ err, url }, `${method} upstream unreachable`);
    return reply.code(502).send({ error: method === 'GET' ? 'read API unreachable' : 'write API unreachable' });
  }
}

/** Returns the Access-Control-Allow-Origin value for a request origin, or null to send none. */export function corsPolicy(origins: readonly string[]): (origin: string | undefined) => string | null {
  if (origins.includes('*')) return () => '*';
  const allowed = new Set(origins.map((o) => o.replace(/\/+$/, '')));
  return (origin) => (origin && allowed.has(origin) ? origin : null);
}

declare module 'fastify' {
  interface FastifyInstance {
    snapshotStream: SnapshotStream;
  }
}
