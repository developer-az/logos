import { retryRetriable } from '../src/kafka/retry';

const retriable = (message: string) => Object.assign(new Error(message), { retriable: true });

describe('retryRetriable', () => {
  it('retries a retriable Kafka error until it succeeds', async () => {
    let calls = 0;
    const result = await retryRetriable('offsets', async () => {
      calls++;
      if (calls < 3) throw retriable('This server is not the leader for that topic-partition');
      return 'ok';
    }, { baseDelayMs: 1 });

    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('propagates a non-retriable error immediately', async () => {
    const fatal = new Error('UnknownTopicOrPartition');
    let calls = 0;
    await expect(
      retryRetriable('offsets', async () => {
        calls++;
        throw fatal;
      }, { baseDelayMs: 1 }),
    ).rejects.toBe(fatal);
    expect(calls).toBe(1);
  });

  it('gives up after the attempt budget', async () => {
    let calls = 0;
    await expect(
      retryRetriable('offsets', async () => {
        calls++;
        throw retriable('not leader');
      }, { attempts: 3, baseDelayMs: 1 }),
    ).rejects.toThrow('not leader');
    expect(calls).toBe(3);
  });

  it('does not retry once the caller aborted', async () => {
    const aborter = new AbortController();
    aborter.abort();
    let calls = 0;
    await expect(
      retryRetriable('offsets', async () => {
        calls++;
        throw retriable('not leader');
      }, { baseDelayMs: 1, signal: aborter.signal }),
    ).rejects.toThrow('not leader');
    expect(calls).toBe(1);
  });
});
