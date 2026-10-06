export interface Config {
  port: number;
  webhookSecret: string;
  kafkaBrokers: string[];
  kafkaTopic: string;
  kafkaSasl?: { username: string; password: string };
  kafkaCaPath?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const webhookSecret = env.JIRA_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error('JIRA_WEBHOOK_SECRET is required');

  const username = env.KAFKA_SASL_USERNAME;
  const password = env.KAFKA_SASL_PASSWORD;

  return {
    port: Number(env.PORT ?? 8080),
    webhookSecret,
    kafkaBrokers: (env.KAFKA_BROKERS ?? 'localhost:9092').split(',').map((b) => b.trim()),
    kafkaTopic: env.KAFKA_TOPIC ?? 'jira.issue-events.v1',
    kafkaSasl: username && password ? { username, password } : undefined,
    kafkaCaPath: env.KAFKA_SSL_CA_PATH,
  };
}
