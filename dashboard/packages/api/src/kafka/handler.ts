import { parseEvent } from '@orderflow/contracts';
import type { Projection } from '../projection/projection';
import type { Metrics } from '../metrics';
import type { CatchUpTracker } from './catch-up';

/** The subset of a Kafka message the handler needs; matches kafkajs's EachMessagePayload. */
export interface IncomingMessage {
  topic: string;
  partition: number;
  message: {
    offset: string;
    key: Buffer | null;
    value: Buffer | null;
    headers?: Record<string, Buffer | string | (Buffer | string)[] | undefined>;
  };
}

export interface DeadLetter {
  sourceTopic: string;
  partition: number;
  offset: string;
  key: Buffer | null;
  value: Buffer | null;
  error: string;
}

export interface HandlerDeps {
  projection: Projection;
  tracker: () => CatchUpTracker | undefined;
  metrics: Metrics;
  /** Forwards a poison message for inspection. Omit to only count and skip it. */
  deadLetter?: (letter: DeadLetter) => Promise<void>;
  log: {
    warn: (obj: object, msg: string) => void;
  };
}

/**
 * Validates one Kafka message and folds it into the projection.
 *
 * A message that fails validation is counted, optionally dead-lettered, and skipped. It is
 * never retried: a schema error won't fix itself, and blocking the partition on it would
 * freeze the dashboard (the classic poison-pill failure).
 */
export function createMessageHandler(deps: HandlerDeps) {
  return async ({ topic, partition, message }: IncomingMessage): Promise<void> => {
    const parsed = parseEvent(message.value);
    if (parsed.kind === 'event') {
      const outcome = deps.projection.apply(parsed.event);
      deps.metrics.events.inc({ event_type: parsed.event.eventType, outcome });
    } else if (parsed.kind === 'unsupported') {
      // The contract says to ignore types we don't know; a newer schemaVersion is skipped too
      // rather than misread. Neither is an error, so nothing is dead-lettered.
      deps.projection.recordUnsupported();
      deps.metrics.unsupported.inc();
    } else {
      deps.projection.recordInvalid();
      deps.metrics.invalid.inc({ topic });
      deps.log.warn(
        { topic, partition, offset: message.offset, error: parsed.error },
        'skipping message that failed contract validation',
      );
      if (deps.deadLetter) {
        await deps.deadLetter({
          sourceTopic: topic,
          partition,
          offset: message.offset,
          key: message.key,
          value: message.value,
          error: parsed.error,
        });
        deps.metrics.deadLettered.inc({ topic });
      }
    }
    deps.tracker()?.markProcessed(topic, partition, message.offset);
  };
}
