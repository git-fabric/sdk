// src/index.ts
// Fabric-SDK Gateway — main entrypoint
// Wires: Redis → F-RIB → Firewall → DNS → Interceptor → Fastify

import 'dotenv/config';
import { Redis } from 'ioredis';
import { loadConfig } from './core/config.js';
import { logger } from './core/logger.js';
import { FRIB } from './frib/index.js';
import { Firewall } from './firewall/index.js';
import { DNSResolver } from './dns/index.js';
import { Interceptor } from './interceptor/index.js';
import { createServer } from './mcp/server.js';

export async function start(configPath?: string): Promise<void> {
  const config = loadConfig(configPath);

  logger.level = config.log_level;
  logger.info('[Gateway] Starting Fabric-SDK Gateway v0.1.0');

  // ── Redis ────────────────────────────────────────────────────────
  // Parse redis URL to host/port
  const redisUrl = new URL(config.redis_url);
  const redisHost = redisUrl.hostname;
  const redisPort = parseInt(redisUrl.port || '6379', 10);
  logger.info(`[Redis] Connecting to ${redisHost}:${redisPort} (from ${config.redis_url})`);

  const redis = new Redis({
    host: redisHost,
    port: redisPort,
    retryStrategy: (times: number) => Math.min(times * 500, 5000),
    maxRetriesPerRequest: null,
    connectTimeout: 10000,
  });

  redis.on('error', (err: Error) => logger.error(`[Redis] ${err.message || (err as any).code || 'unknown error'}`));

  // Wait for initial connection
  await new Promise<void>((resolve, reject) => {
    redis.once('connect', () => {
      logger.info('[Redis] Connected');
      resolve();
    });
    redis.once('end', () => reject(new Error('Redis connection ended before connecting')));
    setTimeout(() => reject(new Error('Redis connection timeout (30s)')), 30000);
  });

  // ── Layer instantiation (bottom → top, OSI L2 → L4) ─────────────
  const frib        = new FRIB(redis);
  const firewall    = new Firewall(config.firewall);
  const dns         = new DNSResolver(frib, redis, config);
  const interceptor = new Interceptor(dns, frib, config);

  // ── Keepalive reaper — runs on interval ──────────────────────────
  const reaperInterval = setInterval(async () => {
    try {
      await frib.reapStale(
        config.keepalive_miss_threshold,
        config.keepalive_dead_threshold,
        config.keepalive_interval_ms,
      );
    } catch (err) {
      logger.error(`[Reaper] ${(err as Error).message}`);
    }
  }, config.keepalive_interval_ms);

  // ── HTTP server ──────────────────────────────────────────────────
  const server = await createServer(config, frib, firewall, dns, interceptor);

  await server.listen({ port: config.port, host: '0.0.0.0' });
  logger.info(`[Gateway] Listening on port ${config.port}`);
  logger.info('[Gateway] Endpoints: /health /frib /register /keepalive /withdraw /dns/resolve /intercept /audit /metrics');

  // ── Graceful shutdown ────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info(`[Gateway] ${signal} received — shutting down`);
    clearInterval(reaperInterval);
    await server.close();
    await redis.quit();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

// Export types for fabric authors
export type {
  FabricRegistration, WorkerIdentity, WorkerHealth, RoutePrefix,
  DNSQuery, DNSResponse, InterceptorResult, FirewallDecision,
  FRIBEntry, FabricSession, GatewayConfig, AuditEntry,
  WorkerType, WorkerStatus, FabricStatus, RoutingLane,
} from './types/index.js';

export { FRIB } from './frib/index.js';
export { Firewall } from './firewall/index.js';
export { DNSResolver } from './dns/index.js';
export { Interceptor } from './interceptor/index.js';

// CLI direct execution
if (process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.ts')) {
  start().catch((err) => {
    logger.error(`[Gateway] Fatal: ${err.message}`);
    process.exit(1);
  });
}
