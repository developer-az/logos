import Fastify, { FastifyInstance } from 'fastify';
import { normalize, UnsupportedPayloadError } from './jira/normalize';
import { verifySignature } from './jira/signature';
import { JiraWebhook } from './jira/webhook';
import { EventPublisher } from './publisher';

export interface AppOptions {
  publisher: EventPublisher;
  webhookSecret: string;
  logger?: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export function buildApp({ publisher, webhookSecret, logger = false }: AppOptions): FastifyInstance {
  const app = Fastify({ logger, bodyLimit: 1024 * 1024 });

  // Keep the exact bytes: the HMAC is computed over the raw body, not re-serialized JSON.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    req.rawBody = body as Buffer;
    try {
      done(null, JSON.parse((body as Buffer).toString('utf8')));
    } catch {
      const err = new Error('Body is not valid JSON') as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.post<{ Body: JiraWebhook }>('/webhooks/jira', async (req, reply) => {
    const signature = req.headers['x-hub-signature'];
    if (!req.rawBody || !verifySignature(req.rawBody, Array.isArray(signature) ? signature[0] : signature, webhookSecret)) {
      return reply.code(401).send({ error: 'invalid signature' });
    }

    let events;
    try {
      events = normalize(req.body);
    } catch (err) {
      if (err instanceof UnsupportedPayloadError) {
        // 422 tells Jira not to treat this as a transient failure worth retrying.
        return reply.code(422).send({ error: err.message });
      }
      throw err;
    }

    // Only acknowledge once Kafka has the events; a 5xx makes Jira retry, and ids dedupe.
    await publisher.publish(events);
    return reply.code(202).send({ accepted: events.length });
  });

  return app;
}
