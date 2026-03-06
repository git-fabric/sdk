// src/frib/index.ts
// Fabric Routing Information Base (F-RIB)
// BGP-style routing table for fabric knowledge prefixes
// Backed by Redis — survives gateway restarts

import Redis from 'ioredis';
import { createHash } from 'crypto';
import type {
  FRIBEntry, FabricSession, FabricRegistration,
  RoutePrefix, WorkerStatus, FabricStatus, AuditEntry
} from '../types/index.js';
import { logger } from '../core/logger.js';

const FRIB_PREFIX   = 'fabric:rib:';
const SESSION_PREFIX = 'fabric:session:';
const AUDIT_KEY     = 'fabric:audit';

export class FRIB {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  // ─── Registration ──────────────────────────────────────────────

  async register(reg: FabricRegistration): Promise<string> {
    const session_token = createHash('sha256')
      .update(`${reg.fabric_id}:${Date.now()}`)
      .digest('hex')
      .slice(0, 24);

    const now = Math.floor(Date.now() / 1000);

    // Upsert F-RIB entries for each advertised route prefix
    for (const route of reg.routes) {
      await this.upsertRoute(reg, route, now);
    }

    // Store session
    const session: FabricSession = {
      fabric_id:         reg.fabric_id,
      session_token,
      connected_at:      now,
      last_keepalive:    now,
      routes_advertised: reg.routes.map(r => r.prefix),
      status:            'active',
      as_number:         reg.as_number,
      mcp_endpoint:      reg.mcp_endpoint,
      ollama_endpoint:   reg.ollama_endpoint,
    };

    await this.redis.set(
      `${SESSION_PREFIX}${reg.fabric_id}`,
      JSON.stringify(session),
      'EX', 3600
    );

    await this.audit({
      audit_id:   this.auditId(),
      timestamp:  now,
      event_type: 'register',
      fabric_id:  reg.fabric_id,
      metadata:   { prefixes: reg.routes.map(r => r.prefix), as: reg.as_number }
    });

    logger.info(`[F-RIB] Registered fabric=${reg.fabric_id} AS=${reg.as_number} prefixes=${reg.routes.map(r => r.prefix).join(',')}`);
    return session_token;
  }

  private async upsertRoute(
    reg: FabricRegistration,
    route: RoutePrefix,
    now: number
  ): Promise<void> {
    // Check for prefix conflict — ADR-002 §14
    const existing = await this.getByPrefix(route.prefix);
    if (existing && existing.fabric_id !== reg.fabric_id) {
      if (existing.local_pref >= route.local_pref) {
        logger.warn(`[F-RIB] Prefix conflict: ${route.prefix} owned by ${existing.fabric_id} (pref=${existing.local_pref}), rejecting from ${reg.fabric_id} (pref=${route.local_pref})`);
        return;
      }
      logger.warn(`[F-RIB] Prefix takeover: ${route.prefix} from ${existing.fabric_id} → ${reg.fabric_id} (higher pref)`);
    }

    const workerStatuses = reg.worker_pool.workers.map(w => w.status);
    const healthyCount   = workerStatuses.filter(s => s === 'healthy').length;
    const workerHealth: WorkerStatus =
      healthyCount === 0 ? 'failed' :
      healthyCount / reg.worker_pool.total < 0.5 ? 'degraded' : 'healthy';

    const entry: FRIBEntry = {
      fabric_id:        reg.fabric_id,
      as_number:        reg.as_number,
      mcp_endpoint:     reg.mcp_endpoint,
      ollama_endpoint:  reg.ollama_endpoint,
      local_pref:       route.local_pref ?? 100,
      confidence_floor: route.confidence_floor ?? 0.7,
      last_seen:        now,
      worker_health:    workerHealth,
      ttl:              route.ttl ?? 300,
      prefix:           route.prefix,
      description:      route.description,
    };

    await this.redis.set(
      `${FRIB_PREFIX}${route.prefix}`,
      JSON.stringify(entry),
      'EX', (route.ttl ?? 300) + 60  // Redis TTL slightly longer than route TTL
    );
  }

  // ─── Keepalive (ADR-002 §11) ───────────────────────────────────

  async keepalive(fabric_id: string, session_token: string, workerPool: {
    total: number; healthy: number; workers: { status: string }[]
  }): Promise<{ ok: boolean; status: FabricStatus }> {
    const session = await this.getSession(fabric_id);
    if (!session || session.session_token !== session_token) {
      return { ok: false, status: 'withdrawn' };
    }

    const now  = Math.floor(Date.now() / 1000);
    const healthRatio = workerPool.healthy / Math.max(workerPool.total, 1);

    session.last_keepalive = now;
    session.status = healthRatio >= 0.5 ? 'active' : 'degraded';

    await this.redis.set(
      `${SESSION_PREFIX}${fabric_id}`,
      JSON.stringify(session),
      'EX', 3600
    );

    // Update local_pref on routes if worker health changed
    if (healthRatio < 0.5) {
      await this.degradeRoutes(fabric_id, session.routes_advertised);
    } else {
      await this.restoreRoutes(fabric_id, session.routes_advertised);
    }

    return { ok: true, status: session.status };
  }

  private async degradeRoutes(fabric_id: string, prefixes: string[]): Promise<void> {
    for (const prefix of prefixes) {
      const entry = await this.getByPrefix(prefix);
      if (entry && entry.fabric_id === fabric_id) {
        entry.local_pref = Math.max(1, Math.floor(entry.local_pref / 2));
        entry.worker_health = 'degraded';
        await this.redis.set(`${FRIB_PREFIX}${prefix}`, JSON.stringify(entry), 'EX', entry.ttl + 60);
        logger.warn(`[F-RIB] Degraded route prefix=${prefix} fabric=${fabric_id} new_pref=${entry.local_pref}`);
      }
    }
  }

  private async restoreRoutes(fabric_id: string, prefixes: string[]): Promise<void> {
    for (const prefix of prefixes) {
      const entry = await this.getByPrefix(prefix);
      if (entry && entry.fabric_id === fabric_id && entry.worker_health === 'degraded') {
        entry.local_pref  = 100;
        entry.worker_health = 'healthy';
        await this.redis.set(`${FRIB_PREFIX}${prefix}`, JSON.stringify(entry), 'EX', entry.ttl + 60);
        logger.info(`[F-RIB] Restored route prefix=${prefix} fabric=${fabric_id}`);
      }
    }
  }

  // ─── Withdrawal (ADR-002 §11) ──────────────────────────────────

  async withdraw(fabric_id: string, session_token: string, prefixes?: string[]): Promise<void> {
    const session = await this.getSession(fabric_id);
    if (!session || session.session_token !== session_token) return;

    const toWithdraw = prefixes ?? session.routes_advertised;
    for (const prefix of toWithdraw) {
      const entry = await this.getByPrefix(prefix);
      if (entry?.fabric_id === fabric_id) {
        await this.redis.del(`${FRIB_PREFIX}${prefix}`);
        logger.info(`[F-RIB] Withdrawn prefix=${prefix} fabric=${fabric_id}`);
      }
    }

    if (!prefixes) {
      // Full withdrawal — remove session
      await this.redis.del(`${SESSION_PREFIX}${fabric_id}`);
    } else {
      session.routes_advertised = session.routes_advertised.filter(p => !prefixes.includes(p));
      await this.redis.set(`${SESSION_PREFIX}${fabric_id}`, JSON.stringify(session), 'EX', 3600);
    }

    await this.audit({
      audit_id:   this.auditId(),
      timestamp:  Math.floor(Date.now() / 1000),
      event_type: 'withdraw',
      fabric_id,
      metadata:   { prefixes: toWithdraw }
    });
  }

  // ─── Stale session reaper ──────────────────────────────────────

  async reapStale(missThreshold: number, deadThreshold: number, intervalMs: number): Promise<void> {
    const now       = Math.floor(Date.now() / 1000);
    const intervalS = intervalMs / 1000;
    const sessions  = await this.allSessions();

    for (const session of sessions) {
      const missedIntervals = Math.floor((now - session.last_keepalive) / intervalS);

      if (missedIntervals >= deadThreshold) {
        logger.warn(`[F-RIB] Fabric ${session.fabric_id} dead (${missedIntervals} missed keepalives) — withdrawing`);
        await this.redis.del(`${SESSION_PREFIX}${session.fabric_id}`);
        for (const prefix of session.routes_advertised) {
          await this.redis.del(`${FRIB_PREFIX}${prefix}`);
        }
        await this.audit({
          audit_id:   this.auditId(),
          timestamp:  now,
          event_type: 'withdraw',
          fabric_id:  session.fabric_id,
          metadata:   { reason: 'keepalive_timeout', missed: missedIntervals }
        });
      } else if (missedIntervals >= missThreshold) {
        logger.warn(`[F-RIB] Fabric ${session.fabric_id} degraded (${missedIntervals} missed keepalives)`);
        await this.degradeRoutes(session.fabric_id, session.routes_advertised);
        session.status = 'degraded';
        await this.redis.set(`${SESSION_PREFIX}${session.fabric_id}`, JSON.stringify(session), 'EX', 3600);
      }
    }
  }

  // ─── Route resolution (ADR-002 §13) ───────────────────────────

  async resolve(domain_hint?: string): Promise<FRIBEntry | null> {
    if (!domain_hint) return null;

    // Try exact match first (longest prefix)
    const exact = await this.getByPrefix(domain_hint);
    if (exact) return exact;

    // Try parent prefixes — e.g. fabric.cve.npm → fabric.cve
    const parts = domain_hint.split('.');
    for (let i = parts.length - 1; i >= 1; i--) {
      const candidate = parts.slice(0, i).join('.');
      const entry = await this.getByPrefix(candidate);
      if (entry) return entry;
    }

    return null;
  }

  async resolveAll(domain_hint?: string): Promise<FRIBEntry[]> {
    const all   = await this.allRoutes();
    const match = domain_hint
      ? all.filter(e => domain_hint.startsWith(e.prefix) || e.prefix.startsWith(domain_hint))
      : all;

    // Sort by path selection rules (ADR-002 §13):
    // 1. Longest prefix  2. Highest local_pref  3. Highest confidence_floor  4. Freshest
    return match.sort((a, b) => {
      const lenDiff = b.prefix.length - a.prefix.length;
      if (lenDiff !== 0) return lenDiff;
      const prefDiff = b.local_pref - a.local_pref;
      if (prefDiff !== 0) return prefDiff;
      const confDiff = b.confidence_floor - a.confidence_floor;
      if (confDiff !== 0) return confDiff;
      return b.last_seen - a.last_seen;
    });
  }

  // ─── Lookups ───────────────────────────────────────────────────

  async getByPrefix(prefix: string): Promise<FRIBEntry | null> {
    const raw = await this.redis.get(`${FRIB_PREFIX}${prefix}`);
    return raw ? JSON.parse(raw) as FRIBEntry : null;
  }

  async getSession(fabric_id: string): Promise<FabricSession | null> {
    const raw = await this.redis.get(`${SESSION_PREFIX}${fabric_id}`);
    return raw ? JSON.parse(raw) as FabricSession : null;
  }

  async allRoutes(): Promise<FRIBEntry[]> {
    const keys = await this.redis.keys(`${FRIB_PREFIX}*`);
    if (!keys.length) return [];
    const vals = await this.redis.mget(...keys);
    return vals.filter(Boolean).map(v => JSON.parse(v!) as FRIBEntry);
  }

  async allSessions(): Promise<FabricSession[]> {
    const keys = await this.redis.keys(`${SESSION_PREFIX}*`);
    if (!keys.length) return [];
    const vals = await this.redis.mget(...keys);
    return vals.filter(Boolean).map(v => JSON.parse(v!) as FabricSession);
  }

  // ─── Audit ─────────────────────────────────────────────────────

  async audit(entry: AuditEntry): Promise<void> {
    await this.redis.lpush(AUDIT_KEY, JSON.stringify(entry));
    await this.redis.ltrim(AUDIT_KEY, 0, 9999); // keep last 10k entries
  }

  async getAuditLog(limit = 100): Promise<AuditEntry[]> {
    const raw = await this.redis.lrange(AUDIT_KEY, 0, limit - 1);
    return raw.map(r => JSON.parse(r) as AuditEntry);
  }

  private auditId(): string {
    return createHash('sha256').update(`${Date.now()}:${Math.random()}`).digest('hex').slice(0, 16);
  }
}
