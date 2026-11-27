/** The shape of a retriable Kafka error; kafkajs marks transient protocol errors this way. */
interface Retriable {
  retriable?: boolean;
}

export interface RetryLog {
  warn(obj: Record<string, unknown>, message: string): void;
}

/**
 * Runs `fn` again when Kafka says the error is retriable (for example a topic partition whose
 * leader has not been elected yet, which happens during startup). Non-retriable errors and the
 * final attempt propagate. KafkaJS's own client retry does not cover admin calls made this early.
 */
export async function retryRetriable<T>(
  what: string,
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number; log?: RetryLog; signal?: AbortSignal } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 10;
  const baseDelayMs = opts.baseDelayMs ?? 200;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retriable = (err as Retriable).retriable === true;
      if (!retriable || attempt >= attempts || opts.signal?.aborted) throw err;
      opts.log?.warn(
        { attempt, error: (err as Error).message },
        `${what} hit a retriable Kafka error; retrying`,
      );
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }
}
