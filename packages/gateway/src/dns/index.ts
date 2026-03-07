// src/dns/index.ts
// Unicast DNS resolver — fabric-to-fabric knowledge resolution
// Consults F-RIB, queries authoritative fabric, caches results in Redis
// ADR-002 §12

import axios from 'axios';
import { createHash } from 'crypto';
import { Redis } from 'ioredis';
import type {
  DNSQuery, DNSResponse, DNSResult, FRIBEntry,
  RoutingLane, GatewayConfig
} from '../types/index.js';
import { FRIB } from '../frib/index.js';
import { logger } from '../core/logger.js';

const DNS_CACHE_PREFIX = 'fabric:dns:';

export class DNSResolver {
  private frib: FRIB;
  private redis: Redis;
  private cacheTTL: number;
  private defaultConfidenceFloor: number;

  constructor(frib: FRIB, redis: Redis, config: GatewayConfig) {
    this.frib                   = frib;
    this.redis                  = redis;
    this.cacheTTL               = config.dns_cache_ttl_s;
    this.defaultConfidenceFloor = config.default_confidence_floor;
  }

  // ─── Main resolution entry point ──────────────────────────────

  async resolve(query: DNSQuery): Promise<DNSResponse> {
    const queryHash = this.hashQuery(query);

    // 1. Check Redis cache first
    const cached = await this.fromCache(queryHash);
    if (cached) {
      logger.debug(`[DNS] Cache hit hash=${queryHash} requestor=${query.requestor_fabric_id}`);
      await this.frib.audit({
        audit_id:     queryHash,
        timestamp:    Math.floor(Date.now() / 1000),
        event_type:   'dns_resolve',
        fabric_id:    cached.results[0]?.fabric_id,
        routing_lane: cached.routing_lane,
        decision:     'cache_hit',
        metadata:     { source: 'cache' },
      });
      return { ...cached, query_hash: queryHash };
    }

    // 2. Consult F-RIB for authoritative fabric
    const candidates = await this.frib.resolveAll(query.domain_hint);

    // Exclude the requesting fabric from resolution (no self-referral)
    const eligible = candidates.filter(e =>
      e.fabric_id !== query.requestor_fabric_id &&
      e.worker_health !== 'failed'
    );

    if (!eligible.length) {
      logger.info(`[DNS] No eligible fabric for domain=${query.domain_hint} → escalate to Claude`);
      return this.escalateResponse(queryHash, query.query_text);
    }

    // 3. Query the top candidate (unicast — not broadcast)
    const primary = eligible[0];
    const result  = await this.queryFabric(primary, query);

    if (result && result.confidence >= (primary.confidence_floor ?? this.defaultConfidenceFloor)) {
      // High confidence — cache and return
      const response: DNSResponse = {
        resolved:      true,
        results:       [result],
        routing_lane:  this.laneFromConfidence(result.confidence, primary.confidence_floor),
        query_hash:    queryHash,
      };
      await this.cache(queryHash, response);
      await this.frib.audit({
        audit_id:     queryHash,
        timestamp:    Math.floor(Date.now() / 1000),
        event_type:   'dns_resolve',
        fabric_id:    primary.fabric_id,
        prefix:       primary.prefix,
        routing_lane: response.routing_lane,
        decision:     `resolved via ${primary.fabric_id} confidence=${result.confidence.toFixed(2)}`,
        metadata:     { source: 'fabric' },
      });
      return response;
    }

    // 4. Try aggregating from multiple fabrics (ADR-002 §13 — tie resolution)
    if (eligible.length > 1) {
      const aggregated = await this.aggregate(eligible.slice(0, 3), query);
      if (aggregated) {
        const response: DNSResponse = {
          resolved:     true,
          results:      aggregated,
          routing_lane: 'local-llm',
          query_hash:   queryHash,
        };
        await this.cache(queryHash, response);
        return response;
      }
    }

    // 5. Nobody knows — escalate to Claude with whatever context we have
    const partialContext = result?.context;
    return this.escalateResponse(queryHash, query.query_text, partialContext);
  }

  // ─── Unicast query to a single fabric's MCP endpoint ─────────

  private async queryFabric(entry: FRIBEntry, query: DNSQuery): Promise<DNSResult | null> {
    try {
      const resp = await axios.post(
        `${entry.mcp_endpoint}/tools/call`,
        {
          name: 'aiana_query',
          arguments: {
            query_text: query.query_text,
            top_k:      query.top_k ?? 5,
          },
        },
        { timeout: 5000 }
      );

      const data = resp.data as { context?: string; confidence?: number };
      if (!data.context) return null;

      return {
        fabric_id:  entry.fabric_id,
        prefix:     entry.prefix,
        context:    data.context,
        confidence: data.confidence ?? 0,
        source:     'fabric',
      };
    } catch (err) {
      logger.warn(`[DNS] Failed to query fabric=${entry.fabric_id} endpoint=${entry.mcp_endpoint}: ${(err as Error).message}`);
      return null;
    }
  }

  // ─── Aggregate context from multiple fabrics ──────────────────

  private async aggregate(entries: FRIBEntry[], query: DNSQuery): Promise<DNSResult[] | null> {
    const results: DNSResult[] = [];

    for (const entry of entries) {
      const result = await this.queryFabric(entry, query);
      if (result && result.confidence > 0.3) {
        results.push({ ...result, source: 'aggregated' });
      }
    }

    return results.length > 0 ? results : null;
  }

  // ─── Escalation path — Claude default route ───────────────────

  private escalateResponse(queryHash: string, queryText: string, partialContext?: string): DNSResponse {
    return {
      resolved:      false,
      results:       [],
      routing_lane:  'claude',
      claude_context: partialContext
        ? `Partial context from fabric knowledge base:\n\n${partialContext}\n\nQuery: ${queryText}`
        : undefined,
      query_hash:    queryHash,
    };
  }

  // ─── Cache ────────────────────────────────────────────────────

  private async fromCache(queryHash: string): Promise<DNSResponse | null> {
    const raw = await this.redis.get(`${DNS_CACHE_PREFIX}${queryHash}`);
    if (!raw) return null;
    const cached = JSON.parse(raw) as DNSResponse & { cached_at: number };
    // Tag results as cache hits
    cached.results = cached.results.map(r => ({ ...r, source: 'cache' as const }));
    return cached;
  }

  private async cache(queryHash: string, response: DNSResponse): Promise<void> {
    const payload = { ...response, cached_at: Math.floor(Date.now() / 1000) };
    await this.redis.set(
      `${DNS_CACHE_PREFIX}${queryHash}`,
      JSON.stringify(payload),
      'EX', this.cacheTTL
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private hashQuery(query: DNSQuery): string {
    const key = `${query.query_text}:${query.domain_hint ?? ''}:${query.top_k ?? 5}`;
    return createHash('sha256').update(key).digest('hex').slice(0, 24);
  }

  private laneFromConfidence(confidence: number, floor: number = this.defaultConfidenceFloor): RoutingLane {
    if (confidence >= 0.95) return 'deterministic';
    if (confidence >= floor) return 'local-llm';
    return 'claude';
  }
}
