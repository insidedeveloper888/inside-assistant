import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import type { NextRequest } from "next/server";

/**
 * Per-endpoint sliding-window rate limiters, shared across the app.
 *
 * Graceful no-op when UPSTASH_REDIS_REST_* env vars aren't set — the
 * exported `enforce()` function returns null (allow). Means dev + first
 * deploys before Upstash is wired up don't break.
 *
 * Why per-endpoint windows: a heavy chat session shouldn't burn the
 * memory-search budget. Each gets its own bucket.
 */

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

export type LimiterName = "chat" | "memory-search";

const LIMITERS: Record<LimiterName, Ratelimit | null> = redis
  ? {
      // /api/chat hits the Claude proxy which costs real money per call.
      // 30 messages/min per user is generous for human typing speed
      // (~2 messages/sec sustained) but blocks runaway loops.
      chat: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(30, "60 s"),
        prefix: "rl:chat",
      }),
      // Memory search runs on every chat turn + on direct queries from
      // the admin browser. Embed cost is small (~$0.0001) but stacks.
      "memory-search": new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(120, "60 s"),
        prefix: "rl:mem",
      }),
    }
  : { chat: null, "memory-search": null };

export function clientKey(req: NextRequest, fallback?: string): string {
  return (
    fallback ??
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "anon"
  );
}

export type RateLimitResult = {
  blocked: true;
  status: 429;
  headers: Record<string, string>;
  body: { error: string; message: string };
} | null;

/**
 * Check the named limiter against the given identifier (usually userId
 * or IP). Returns `null` if allowed, or a {blocked, ...} object the
 * caller should turn into a Response.
 *
 * Identifier choice matters: rate limit per USER for authenticated
 * endpoints (so multiple devices share the budget), per IP for
 * anonymous endpoints.
 */
export async function enforce(
  name: LimiterName,
  identifier: string
): Promise<RateLimitResult> {
  const limiter = LIMITERS[name];
  if (!limiter) return null; // no Redis → no enforcement

  const { success, limit, remaining, reset } = await limiter.limit(identifier);
  if (success) return null;

  return {
    blocked: true,
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "X-RateLimit-Limit": String(limit),
      "X-RateLimit-Remaining": String(Math.max(0, remaining)),
      "X-RateLimit-Reset": String(reset),
      "Retry-After": String(Math.max(1, Math.ceil((reset - Date.now()) / 1000))),
    },
    body: {
      error: "Too many requests",
      message: "You're going too fast. Wait a few seconds and try again.",
    },
  };
}
