// src/types/index.ts
// Fabric-SDK Gateway — shared types
// All ADR-001 and ADR-002 contracts expressed as TypeScript interfaces

export type WorkerType = 'reactive' | 'proactive' | 'stateful';
export type WorkerStatus = 'healthy' | 'degraded' | 'failed';
export type FabricStatus = 'active' | 'degraded' | 'withdrawn';
export type RoutingLane = 'deterministic' | 'local-llm' | 'claude';

// ─── Worker identity (ADR-002 §1) ─────────────────────────────────
export interface WorkerIdentity {
  worker_id: string;        // {fabric}.{domain}.{instance}
  fabric_id: string;
  worker_type: WorkerType;
  version: string;
  capabilities: string[];
  supervisor: string;       // github-actions | n8n | cron
}

export interface WorkerHealth {
  worker_id: string;
  status: WorkerStatus;
  active_work_unit?: string;
  last_completion?: number; // unix timestamp
  reported_at: number;
}

// ─── Route prefix (ADR-002 §9) ────────────────────────────────────
export interface RoutePrefix {
  prefix: string;           // fabric.{domain}[.{subdomain}]
  local_pref: number;       // 1–200, default 100
  description: string;
  ttl?: number;             // seconds, default 300
  confidence_floor?: number; // 0.0–1.0, default 0.7
}

// ─── Fabric registration payload (ADR-002 §8) ─────────────────────
export interface FabricRegistration {
  fabric_id: string;
  as_number: number;
  version: string;
  mcp_endpoint: string;
  ollama_endpoint?: string;
  ollama_model?: string;
  supervisor: string;
  tailscale_node: string;
  worker_pool: {
    total: number;
    healthy: number;
    workers: WorkerHealth[];
  };
  routes: RoutePrefix[];
}

// ─── F-RIB entry (ADR-002 §10) ────────────────────────────────────
export interface FRIBEntry {
  fabric_id: string;
  as_number: number;
  mcp_endpoint: string;
  ollama_endpoint?: string;
  local_pref: number;
  confidence_floor: number;
  last_seen: number;
  worker_health: WorkerStatus;
  ttl: number;
  prefix: string;
  description: string;
}

// ─── Session state ─────────────────────────────────────────────────
export interface FabricSession {
  fabric_id: string;
  session_token: string;
  connected_at: number;
  last_keepalive: number;
  routes_advertised: string[];
  status: FabricStatus;
  as_number: number;
  mcp_endpoint: string;
  ollama_endpoint?: string;
}

// ─── Keepalive (ADR-002 §11) ──────────────────────────────────────
export interface KeepalivePayload {
  fabric_id: string;
  session_token: string;
  worker_pool: {
    total: number;
    healthy: number;
    workers: WorkerHealth[];
  };
  timestamp: number;
}

// ─── Route update ─────────────────────────────────────────────────
export interface RouteUpdate {
  fabric_id: string;
  session_token: string;
  action: 'advertise' | 'withdraw';
  routes: RoutePrefix[];
}

// ─── DNS resolution request/response (ADR-002 §12) ────────────────
export interface DNSQuery {
  query_text: string;
  query_embedding?: number[];
  domain_hint?: string;       // fabric.cve, fabric.github, etc.
  requestor_fabric_id: string;
  top_k?: number;
}

export interface DNSResult {
  fabric_id: string;
  prefix: string;
  context: string;
  confidence: number;
  source: 'cache' | 'fabric' | 'aggregated';
  cached_at?: number;
}

export interface DNSResponse {
  resolved: boolean;
  results: DNSResult[];
  routing_lane: RoutingLane;
  claude_context?: string;    // pre-injected context if escalating
  query_hash: string;
}

// ─── Interceptor result ───────────────────────────────────────────
export interface InterceptorResult {
  lane: RoutingLane;
  confidence: number;
  context?: string;
  target_fabric?: string;
  audit_id: string;
}

// ─── Firewall decision ────────────────────────────────────────────
export interface FirewallDecision {
  allowed: boolean;
  reason?: string;
  sanitized_input?: string;
  pii_detected: boolean;
  injection_detected: boolean;
  audit_id: string;
}

// ─── Audit log entry ──────────────────────────────────────────────
export interface AuditEntry {
  audit_id: string;
  timestamp: number;
  event_type: 'register' | 'withdraw' | 'keepalive' | 'dns_resolve' |
              'intercept' | 'firewall' | 'escalate' | 'route_update';
  fabric_id?: string;
  prefix?: string;
  routing_lane?: RoutingLane;
  decision?: string;
  metadata?: Record<string, unknown>;
}

// ─── Gateway config ───────────────────────────────────────────────
export interface GatewayConfig {
  port: number;
  redis_url: string;
  keepalive_interval_ms: number;   // how often fabrics must ping
  keepalive_miss_threshold: number; // missed pings before degraded
  keepalive_dead_threshold: number; // missed pings before withdrawn
  dns_cache_ttl_s: number;
  default_confidence_floor: number;
  firewall: {
    enabled: boolean;
    pii_patterns: string[];
    injection_patterns: string[];
    blocked_prefixes: string[];     // prefixes no fabric can claim (e.g. 0.0.0.0/0)
  };
  claude: {
    api_key?: string;               // optional — gateway can escalate directly
    model: string;
    max_tokens: number;
  };
  log_level: 'debug' | 'info' | 'warn' | 'error';
}
