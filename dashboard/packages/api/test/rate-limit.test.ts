import { createRateLimiter } from '../src/http/rate-limit';

describe('createRateLimiter', () => {
  it('allows up to the limit, then blocks until the window ends', () => {
    let clock = 1_000;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => clock });

    expect(limiter.take('1.2.3.4')).toMatchObject({ allowed: true, remaining: 2 });
    expect(limiter.take('1.2.3.4')).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.take('1.2.3.4')).toMatchObject({ allowed: true, remaining: 0 });

    const blocked = limiter.take('1.2.3.4');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(60_000);

    clock += 60_000;
    expect(limiter.take('1.2.3.4')).toMatchObject({ allowed: true, remaining: 2 });
  });

  it('counts each address separately', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });

    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(false);
    expect(limiter.take('b').allowed).toBe(true);
  });
});
