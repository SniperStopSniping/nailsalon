import Redis from 'ioredis';

// =============================================================================
// REDIS CLIENT (SINGLETON)
// =============================================================================
// CRITICAL: Redis MUST be instantiated as a singleton.
// Creating a new connection per request will crash the app under load.
// =============================================================================

// Global type for caching Redis client across hot reloads
type GlobalWithRedis = typeof globalThis & {
  redisClient?: Redis;
};

const globalForRedis = globalThis as GlobalWithRedis;

/**
 * Get the singleton Redis client instance.
 * Returns null if REDIS_URL is not configured.
 */
function createRedisClient(): Redis | null {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    console.warn('[Redis] REDIS_URL not configured. Redis features will fail closed (503).');
    return null;
  }

  if (!globalForRedis.redisClient) {
    globalForRedis.redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) {
          return null; // Stop retrying
        }
        return Math.min(times * 100, 1000);
      },
      lazyConnect: true,
    });

    globalForRedis.redisClient.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });

    globalForRedis.redisClient.on('connect', () => {
      console.log('[Redis] Connected');
    });
  }

  return globalForRedis.redisClient;
}

export const redis = createRedisClient();

/**
 * Check if Redis is available and connected.
 * Use this before Redis operations to fail closed.
 */
export async function isRedisAvailable(): Promise<boolean> {
  if (!redis) {
    return false;
  }

  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}
