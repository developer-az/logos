import { randomBytes } from 'node:crypto';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('requires the webhook secret', () => {
    expect(() => loadConfig({})).toThrow('JIRA_WEBHOOK_SECRET');
  });

  it('applies defaults and parses broker lists', () => {
    const c = loadConfig({ JIRA_WEBHOOK_SECRET: 'x', KAFKA_BROKERS: 'a:9092, b:9092' });
    expect(c).toMatchObject({ port: 8080, kafkaBrokers: ['a:9092', 'b:9092'], kafkaTopic: 'jira.issue-events.v1' });
    expect(c.kafkaSasl).toBeUndefined();
  });

  it('enables SASL only when both credentials are set', () => {
    const pw = randomBytes(16).toString('hex');
    const c = loadConfig({ JIRA_WEBHOOK_SECRET: 'x', KAFKA_SASL_USERNAME: 'user', KAFKA_SASL_PASSWORD: pw });
    expect(c.kafkaSasl).toEqual({ username: 'user', password: pw });
  });
});
