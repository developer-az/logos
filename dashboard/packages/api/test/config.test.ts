import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('has working local defaults', () => {
    const c = loadConfig({});
    expect(c.kafka.brokers).toEqual(['localhost:9092']);
    expect(c.kafka.topics).toEqual(['orders.events.v1', 'inventory.events.v1']);
    expect(c.kafka.deadLetter?.('orders.events.v1')).toBe('orders.events.v1.dlt');
    expect(c.currency).toBe('USD');
    expect(c.kafka.sasl).toBeNull();
    expect(c.http).toEqual({ port: 8080, host: '0.0.0.0', staticDir: null });
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
});
