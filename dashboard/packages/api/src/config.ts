import { hostname } from 'node:os';
import { TOPICS, deadLetterTopicFor } from '@orderflow/contracts';
import { z } from 'zod';

const list = z
  .string()
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(z.string().min(1)).min(1));

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(8080),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  KAFKA_BROKERS: list.default(['localhost:9092']),
  KAFKA_CLIENT_ID: z.string().default('orderflow-dashboard'),
  /**
   * Consumer group prefix. Each process joins its own group (prefix + host + start time) so
   * every replica reads every partition from the beginning and builds a full read model.
   */
  KAFKA_GROUP_PREFIX: z.string().default('orderflow-dashboard'),
  KAFKA_SSL: bool.default(false),
  KAFKA_SASL_MECHANISM: z.enum(['plain', 'scram-sha-256', 'scram-sha-512']).optional(),
  KAFKA_SASL_USERNAME: z.string().optional(),
  KAFKA_SASL_PASSWORD: z.string().optional(),
  /**
   * PEM files for TLS to the brokers: a CA the brokers' certificates chain to (managed Kafka
   * such as Aiven uses a project CA), and a client certificate and key where the brokers
   * authenticate clients by certificate. Setting any of them turns TLS on.
   */
  KAFKA_SSL_CA_FILE: z.string().optional(),
  KAFKA_SSL_CERT_FILE: z.string().optional(),
  KAFKA_SSL_KEY_FILE: z.string().optional(),
  ORDERS_TOPIC: z.string().default(TOPICS.orders),
  INVENTORY_TOPIC: z.string().default(TOPICS.inventory),
  /**
   * Forward invalid messages to `<source topic>.dlt`, the platform's dead-letter convention.
   * When false they are only counted and logged.
   */
  DEAD_LETTER_ENABLED: bool.default(true),
  LOW_STOCK_THRESHOLD: z.coerce.number().int().min(0).default(5),
  /** Currency the services' decimal amounts are in, for display. */
  CURRENCY: z.string().length(3).default('USD'),
  STREAM_INTERVAL_MS: z.coerce.number().int().min(50).default(500),
  /** Directory of the built web app to serve at /. Empty to serve the API only. */
  STATIC_DIR: z.string().default(''),
  /**
   * Origins allowed to read the API from a browser on another site, comma-separated, or `*`.
   * Needed when the web app is hosted separately (the Vercel build); empty means same origin.
   */
  CORS_ORIGINS: z.string().default(''),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${details.join('\n  ')}`);
  }
  const e = parsed.data;
  if (Boolean(e.KAFKA_SSL_CERT_FILE) !== Boolean(e.KAFKA_SSL_KEY_FILE)) {
    throw new Error(
      'Invalid configuration:\n  KAFKA_SSL_CERT_FILE and KAFKA_SSL_KEY_FILE must be set together',
    );
  }
  const tls =
    e.KAFKA_SSL_CA_FILE || e.KAFKA_SSL_CERT_FILE
      ? {
          caFile: e.KAFKA_SSL_CA_FILE ?? null,
          certFile: e.KAFKA_SSL_CERT_FILE ?? null,
          keyFile: e.KAFKA_SSL_KEY_FILE ?? null,
        }
      : null;
  if (e.KAFKA_SASL_MECHANISM && !(e.KAFKA_SASL_USERNAME && e.KAFKA_SASL_PASSWORD)) {
    throw new Error(
      'Invalid configuration:\n  KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD are required with KAFKA_SASL_MECHANISM',
    );
  }
  return {
    http: {
      port: e.PORT,
      host: e.HOST,
      staticDir: e.STATIC_DIR || null,
      corsOrigins: e.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    },
    logLevel: e.LOG_LEVEL,
    kafka: {
      brokers: e.KAFKA_BROKERS,
      clientId: e.KAFKA_CLIENT_ID,
      groupId: `${e.KAFKA_GROUP_PREFIX}-${hostname()}-${Date.now()}`,
      ssl: e.KAFKA_SSL || tls !== null,
      tls,
      sasl: e.KAFKA_SASL_MECHANISM
        ? {
            mechanism: e.KAFKA_SASL_MECHANISM,
            username: e.KAFKA_SASL_USERNAME!,
            password: e.KAFKA_SASL_PASSWORD!,
          }
        : null,
      topics: [e.ORDERS_TOPIC, e.INVENTORY_TOPIC],
      deadLetter: e.DEAD_LETTER_ENABLED ? deadLetterTopicFor : null,
    },
    lowStockThreshold: e.LOW_STOCK_THRESHOLD,
    currency: e.CURRENCY,
    streamIntervalMs: e.STREAM_INTERVAL_MS,
  };
}
