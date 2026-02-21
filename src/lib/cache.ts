// ============================================================================
// Redis Caching Layer
// ============================================================================
// Wraps ioredis with graceful degradation — if Redis is unavailable the app
// still works, it just won't cache.
// ============================================================================

import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const DEFAULT_TTL = 300; // 5 minutes

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) {
    return redis;
  }
  try {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
    });
    redis.on("error", () => {
      // Silently ignore — we fall back to no-cache
      redis?.disconnect();
      redis = null;
    });
    return redis;
  } catch {
    return null;
  }
}

/**
 * Try to read a cached value. Returns `null` on miss or Redis unavailable.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const client = getRedis();
    if (!client) {
      return null;
    }
    await client.connect().catch(() => {});
    const raw = await client.get(`di:${key}`);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Try to write a value to cache. Fails silently.
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number = DEFAULT_TTL,
): Promise<void> {
  try {
    const client = getRedis();
    if (!client) {
      return;
    }
    await client.connect().catch(() => {});
    await client.set(`di:${key}`, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // no-op
  }
}

/**
 * Invalidate a cached key.
 */
export async function cacheDelete(key: string): Promise<void> {
  try {
    const client = getRedis();
    if (!client) {
      return;
    }
    await client.connect().catch(() => {});
    await client.del(`di:${key}`);
  } catch {
    // no-op
  }
}
