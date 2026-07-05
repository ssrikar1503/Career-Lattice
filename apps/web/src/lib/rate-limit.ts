/**
 * Sliding-window rate limiter — in-memory for prototype.
 *
 * HOW IT WORKS (sliding window):
 *   Unlike "reset at midnight", a sliding window tracks requests in the LAST N
 *   minutes from right now. So if you send 15 messages between 2:00–2:59 and
 *   try again at 3:00, you can only send (limit - requests_in_last_hour) more.
 *   This prevents "burst at the boundary" abuse.
 *
 * PRODUCTION UPGRADE:
 *   Replace the Map with Upstash Redis calls. The interface stays the same.
 *   npm install @upstash/ratelimit @upstash/redis
 *   Then swap checkRateLimit() to use Ratelimit.slidingWindow() from Upstash.
 *
 * WHY IN-MEMORY IS OK FOR PROTOTYPE:
 *   Vercel serverless functions can have multiple instances, so the count won't
 *   be perfectly accurate across instances — but it's close enough for a demo.
 *   The important thing is the architecture is correct and easy to swap.
 */

interface WindowEntry {
  timestamps: number[]; // unix ms of each request in current window
}

// Global store — lives for the lifetime of this server process
const store = new Map<string, WindowEntry>();

export interface RateLimitConfig {
  windowMs:    number; // sliding window duration in ms
  maxRequests: number; // max requests allowed per window
}

export interface RateLimitResult {
  allowed:   boolean;
  remaining: number;
  resetInMs: number;       // ms until oldest request falls out of window
  retryAfter: number;      // seconds to tell client to wait
}

export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now      = Date.now();
  const cutoff   = now - config.windowMs;
  const entry    = store.get(key) ?? { timestamps: [] };

  // Drop timestamps outside the current window (this is the "slide")
  entry.timestamps = entry.timestamps.filter(t => t > cutoff);

  if (entry.timestamps.length >= config.maxRequests) {
    // Oldest request in window — that's when a slot opens up
    const oldest    = entry.timestamps[0];
    const resetInMs = (oldest + config.windowMs) - now;
    store.set(key, entry);
    return {
      allowed:    false,
      remaining:  0,
      resetInMs,
      retryAfter: Math.ceil(resetInMs / 1000),
    };
  }

  entry.timestamps.push(now);
  store.set(key, entry);

  return {
    allowed:    true,
    remaining:  config.maxRequests - entry.timestamps.length,
    resetInMs:  config.windowMs,
    retryAfter: 0,
  };
}

// Clean up old entries every 10 minutes to prevent memory leak
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24h
  for (const [key, entry] of store) {
    if (entry.timestamps.every(t => t < cutoff)) {
      store.delete(key);
    }
  }
}, 10 * 60 * 1000);

// ── Preset configs for our endpoints ──────────────────────────────────────────
export const LIMITS = {
  // AI chat: 15 per hour, 80 per day per IP
  chat_hourly: { windowMs: 60 * 60 * 1000,      maxRequests: 15  },
  chat_daily:  { windowMs: 24 * 60 * 60 * 1000, maxRequests: 80  },
  // Admin actions: generous limits, it's a password-gated single user
  admin:       { windowMs: 60 * 60 * 1000,       maxRequests: 300 },
} satisfies Record<string, RateLimitConfig>;

// ── Extract real IP from Next.js request ──────────────────────────────────────
export function getClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')                              ||
    request.headers.get('cf-connecting-ip')                       || // Cloudflare
    'unknown'
  );
}
