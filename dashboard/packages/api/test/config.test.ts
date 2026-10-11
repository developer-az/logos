import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config';
import { kafkaClientConfig } from '../src/kafka/consumer';

describe('loadConfig', () => {
  it('has working local defaults', () => {
    const c = loadConfig({});
    expect(c.kafka.brokers).toEqual(['localhost:9092']);
    expect(c.kafka.topics).toEqual(['orders.events.v1', 'inventory.events.v1']);
    expect(c.kafka.deadLetter?.('orders.events.v1')).toBe('orders.events.v1.dlt');
    expect(c.currency).toBe('USD');
    expect(c.kafka.sasl).toBeNull();
    expect(c.http).toEqual({ port: 8080, host: '0.0.0.0', staticDir: null, corsOrigins: [] });
    expect(c.kafka.tls).toBeNull();
  });

  it('parses lists, numbers and booleans from strings', () => {
    const c = loadConfig({
      KAFKA_BROKERS: ' b1:9092, b2:9092 ,',
      PORT: '3000',
      KAFKA_SSL: 'true',
      LOW_STOCK_THRESHOLD: '0',
      DEAD_LETTER_ENABLED: 'false',
      CURRENCY: 'EUR',
    });
    expect(c.kafka.brokers).toEqual(['b1:9092', 'b2:9092']);
    expect(c.http.port).toBe(3000);
    expect(c.kafka.ssl).toBe(true);
    expect(c.lowStockThreshold).toBe(0);
    expect(c.kafka.deadLetter).toBeNull();
    expect(c.currency).toBe('EUR');
  });

  it('gives each process its own consumer group', () => {
    expect(loadConfig({ KAFKA_GROUP_PREFIX: 'dash' }).kafka.groupId).toMatch(/^dash-.+-\d+$/);
  });

  it('lists every invalid variable at once', () => {
    expect(() => loadConfig({ PORT: 'eighty', LOG_LEVEL: 'loud' })).toThrow(/PORT[\s\S]*LOG_LEVEL/);
  });

  it('requires credentials with a SASL mechanism', () => {
    expect(() => loadConfig({ KAFKA_SASL_MECHANISM: 'plain' })).toThrow(/KAFKA_SASL_USERNAME/);
    const c = loadConfig({
      KAFKA_SASL_MECHANISM: 'scram-sha-512',
      KAFKA_SASL_USERNAME: 'u',
      KAFKA_SASL_PASSWORD: 'p',
    });
    expect(c.kafka.sasl).toEqual({ mechanism: 'scram-sha-512', username: 'u', password: 'p' });
  });

  it('parses allowed CORS origins', () => {
    expect(loadConfig({ CORS_ORIGINS: 'https://a.vercel.app, https://b.dev' }).http.corsOrigins).toEqual([
      'https://a.vercel.app',
      'https://b.dev',
    ]);
  });

  it('turns TLS on with certificate files and loads them into the Kafka client', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kafka-tls-'));
    const file = (name: string, body: string) => {
      writeFileSync(join(dir, name), body);
      return join(dir, name);
    };
    const c = loadConfig({
      KAFKA_SSL_CA_FILE: file('ca.pem', 'CA'),
      KAFKA_SSL_CERT_FILE: file('service.cert', 'CERT'),
      KAFKA_SSL_KEY_FILE: file('service.key', 'KEY'),
    });
    expect(c.kafka.ssl).toBe(true);
    expect(kafkaClientConfig(c.kafka).ssl).toEqual({ ca: ['CA'], cert: 'CERT', key: 'KEY' });
  });

  it('accepts a CA alone (TLS with SASL) but not a certificate without its key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kafka-tls-'));
    writeFileSync(join(dir, 'ca.pem'), 'CA');
    expect(kafkaClientConfig(loadConfig({ KAFKA_SSL_CA_FILE: join(dir, 'ca.pem') }).kafka).ssl).toEqual({ ca: ['CA'] });
    expect(() => loadConfig({ KAFKA_SSL_CERT_FILE: '/x.cert' })).toThrow(/KAFKA_SSL_KEY_FILE/);
  });

  it('passes plain TLS through as a flag', () => {
    expect(kafkaClientConfig(loadConfig({ KAFKA_SSL: 'true' }).kafka).ssl).toBe(true);
    expect(kafkaClientConfig(loadConfig({}).kafka).ssl).toBe(false);
  });
});
