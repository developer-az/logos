import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { ORDER_STATUSES } from '@orderflow/contracts';
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { z } from 'zod';
import type { Metrics } from '../metrics';
import type { Projection } from '../projection/projection';
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
    reply.hijack();
    stream.attach(reply.raw);
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

declare module 'fastify' {
  interface FastifyInstance {
    snapshotStream: SnapshotStream;
  }
}
