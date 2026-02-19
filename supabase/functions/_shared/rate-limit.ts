/**
 * Simple in-memory rate limiter for edge functions.
 * 
 * Tradeoff: In-memory counters reset on cold starts and are per-isolate.
 * This provides basic abuse protection but is not a hard guarantee.
 * For strict enforcement, use a database table (heavier, more reliable).
 */

interface RateEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateEntry>();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}, 5 * 60 * 1000);

export function checkRateLimit(
  userId: string,
  action: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterSec: number } {
  const key = `${action}:${userId}`;
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  if (entry.count >= maxRequests) {
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, retryAfterSec };
  }

  entry.count++;
  return { allowed: true, retryAfterSec: 0 };
}

export function rateLimitResponse(retryAfterSec: number, corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({
      error: "rate_limited",
      message: `Demasiadas solicitudes. Intenta de nuevo en ${retryAfterSec} segundos.`,
      retry_after_sec: retryAfterSec,
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSec),
      },
    }
  );
}
