import { KafkaJS } from '@confluentinc/kafka-javascript';
import { IssueEvent } from './events';

export interface EventPublisher {
  publish(events: IssueEvent[]): Promise<void>;
  close(): Promise<void>;
}

export interface KafkaSettings {
  brokers: string[];
  topic: string;
  clientId: string;
  sasl?: { username: string; password: string };
  /** PEM CA bundle for the broker TLS listener (Strimzi's cluster CA in-cluster). */
  caPath?: string;
}

/**
 * Uses Confluent's librdkafka-based client (KafkaJS-compatible API). The original `kafkajs`
 * package is no longer maintained, so it is avoided for new work.
 */
export class KafkaPublisher implements EventPublisher {
  private readonly producer: KafkaJS.Producer;
  private connected?: Promise<void>;

  constructor(private readonly settings: KafkaSettings) {
    const kafka = new KafkaJS.Kafka({
      ...(settings.caPath && { 'ssl.ca.location': settings.caPath }),
      kafkaJS: {
        clientId: settings.clientId,
        brokers: settings.brokers,
        ...(settings.sasl && {
          ssl: true,
          sasl: { mechanism: 'scram-sha-512', ...settings.sasl },
        }),
      },
    });
    // Idempotent producer with acks=all: a broker retry cannot create duplicates or reorder.
    this.producer = kafka.producer({ kafkaJS: { idempotent: true, acks: -1 } });
  }

  async publish(events: IssueEvent[]): Promise<void> {
    if (events.length === 0) return;
    this.connected ??= this.producer.connect();
    await this.connected;
    await this.producer.send({
      topic: this.settings.topic,
      messages: events.map((e) => ({ key: e.issueKey, value: JSON.stringify(e) })),
    });
  }

  async close(): Promise<void> {
    if (this.connected) await this.producer.disconnect();
  }
}
