import Redis, { RedisOptions } from 'ioredis';
import { logger } from '../utils/logger';

/**
 * Single source of truth for how we connect to Redis.
 *
 * Supports both a full connection URL (recommended for managed Redis — handles
 * auth and TLS via the `rediss://` scheme) and discrete host/port/password env
 * vars (for docker-compose). Managed providers (Upstash, ElastiCache, Redis
 * Cloud) require auth and usually TLS, which the old host/port-only client could
 * not express.
 *
 * Precedence: REDIS_URL > (REDIS_HOST/PORT/PASSWORD/DB).
 */
export function buildRedisOptions(overrides: RedisOptions = {}): { url?: string; options: RedisOptions } {
  const base: RedisOptions = {
    // Reconnect forever with capped backoff instead of crashing.
    retryStrategy: (times: number) => Math.min(times * 200, 5000),
    enableReadyCheck: true,
    ...overrides
  };

  const url = process.env.REDIS_URL;
  if (url) {
    return { url, options: base };
  }

  base.host = process.env.REDIS_HOST || 'localhost';
  base.port = parseInt(process.env.REDIS_PORT || '6379', 10);
  if (process.env.REDIS_PASSWORD) base.password = process.env.REDIS_PASSWORD;
  if (process.env.REDIS_DB) base.db = parseInt(process.env.REDIS_DB, 10);
  if (process.env.REDIS_TLS === 'true') base.tls = {};

  return { options: base };
}

/**
 * Create a new ioredis client using the unified configuration. Attaches
 * error/connect listeners so an unhandled 'error' event can never crash the
 * process. `name` is used only for log context.
 */
export function createRedisClient(name: string, overrides: RedisOptions = {}): Redis {
  const { url, options } = buildRedisOptions(overrides);
  const client = url ? new Redis(url, options) : new Redis(options);

  client.on('error', (err) => {
    logger.error(`Redis connection error [${name}]`, { error: err.message });
  });
  client.on('connect', () => {
    logger.info(`Connected to Redis [${name}]`);
  });
  client.on('reconnecting', () => {
    logger.warn(`Reconnecting to Redis [${name}]`);
  });

  return client;
}

/**
 * Connection object usable directly by BullMQ (`{ connection: redisConnection }`).
 * BullMQ needs maxRetriesPerRequest: null, which buildRedisOptions already sets.
 */
export function bullmqConnection(): RedisOptions & { url?: string } {
  // BullMQ blocking commands require maxRetriesPerRequest: null.
  const { url, options } = buildRedisOptions({ maxRetriesPerRequest: null });
  return url ? { ...options, url } : options;
}
