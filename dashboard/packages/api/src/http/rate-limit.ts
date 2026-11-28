/** A fixed-window counter per key (a client address), small enough to keep in process. */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface RateLimiter {
  take(key: string): RateLimitResult;
}

export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const { limit, windowMs } = options;
  const now = options.now ?? Date.now;
  const windows = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = now();

  return {
    take(key: string): RateLimitResult {
      const at = now();
      // Drop expired windows occasionally instead of growing forever.
      if (at - lastSweep >= windowMs) {
        for (const [k, v] of windows) if (v.resetAt <= at) windows.delete(k);
        lastSweep = at;
      }

      const current = windows.get(key);
      if (!current || current.resetAt <= at) {
        windows.set(key, { count: 1, resetAt: at + windowMs });
        return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
      }
      if (current.count >= limit) {
        return { allowed: false, remaining: 0, retryAfterMs: current.resetAt - at };
      }
      current.count++;
      return { allowed: true, remaining: limit - current.count, retryAfterMs: 0 };
    },
  };
}
