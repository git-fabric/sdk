// src/interceptor/index.ts
// L4 Interceptor — scores incoming requests and selects routing lane
// Sits between firewall (L2) and DNS resolver (L4 unicast)
// ADR-001 §3, ADR-002 §12

import type {
  InterceptorResult, DNSQuery, DNSResponse,
  GatewayConfig, RoutingLane
} from '../types/index.js';
import { DNSResolver } from '../dns/index.js';
import { FRIB } from '../frib/index.js';
import { logger } from '../core/logger.js';
import { createHash } from 'crypto';

export class Interceptor {
  private dns: DNSResolver;
  private frib: FRIB;
  private confidenceFloor: number;

  constructor(dns: DNSResolver, frib: FRIB, config: GatewayConfig) {
    this.dns             = dns;
    this.frib            = frib;
    this.confidenceFloor = config.default_confidence_floor;
  }

  // ─── Main intercept entry point ───────────────────────────────
  // Called for every request after firewall clears it

  async intercept(params: {
    query_text:          string;
    domain_hint?:        string;
    requestor_fabric_id: string;
  }): Promise<InterceptorResult> {
    const audit_id = this.auditId();

    // 1. Check if any fabric can answer via DNS resolution
    const dnsQuery: DNSQuery = {
      query_text:           params.query_text,
      domain_hint:          params.domain_hint,
      requestor_fabric_id:  params.requestor_fabric_id,
      top_k:                5,
    };

    const dnsResult: DNSResponse = await this.dns.resolve(dnsQuery);

    // 2. Map DNS response to routing lane
    const lane: RoutingLane = dnsResult.routing_lane;

    const topResult    = dnsResult.results[0];
    const confidence   = topResult?.confidence ?? 0;
    const context      = dnsResult.results.map(r => r.context).filter(Boolean).join('\n\n---\n\n');
    const target_fabric = topResult?.fabric_id;

    await this.frib.audit({
      audit_id,
      timestamp:    Math.floor(Date.now() / 1000),
      event_type:   'intercept',
      fabric_id:    params.requestor_fabric_id,
      routing_lane: lane,
      decision:     `lane=${lane} confidence=${confidence.toFixed(2)} target=${target_fabric ?? 'claude'}`,
      metadata: {
        domain_hint: params.domain_hint,
        query_hash:  dnsResult.query_hash,
      },
    });

    logger.info(`[Interceptor] audit=${audit_id} lane=${lane} confidence=${confidence.toFixed(2)} target=${target_fabric ?? 'claude'}`);

    return {
      lane,
      confidence,
      context:        context || dnsResult.claude_context,
      target_fabric,
      audit_id,
    };
  }

  private auditId(): string {
    return createHash('sha256').update(`${Date.now()}:${Math.random()}`).digest('hex').slice(0, 16);
  }
}
