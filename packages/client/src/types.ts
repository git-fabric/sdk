// Client-specific types + re-exports from gateway contract

export type WorkerType = 'reactive' | 'proactive' | 'stateful';
export type WorkerStatus = 'healthy' | 'degraded' | 'failed';
export type FabricStatus = 'active' | 'degraded' | 'withdrawn';
export type RoutingLane = 'deterministic' | 'local-llm' | 'claude';

export interface RoutePrefix {
  prefix: string;
  local_pref: number;
  description: string;
  ttl?: number;
  confidence_floor?: number;
}

export interface WorkerHealth {
  worker_id: string;
  status: WorkerStatus;
  active_work_unit?: string;
  last_completion?: number;
  reported_at: number;
}

export interface WorkerPool {
  total: number;
  healthy: number;
  workers: WorkerHealth[];
}

export interface InterceptorResult {
  lane: RoutingLane;
  confidence: number;
  context?: string;
  target_fabric?: string;
  audit_id: string;
}

export interface DNSResponse {
  resolved: boolean;
  results: DNSResult[];
  routing_lane: RoutingLane;
  claude_context?: string;
  query_hash: string;
}

export interface DNSResult {
  fabric_id: string;
  prefix: string;
  context: string;
  confidence: number;
  source: 'cache' | 'fabric' | 'aggregated';
  cached_at?: number;
}

export interface FabricClientConfig {
  gateway_url: string;
  fabric_id: string;
  as_number: number;
  version: string;
  mcp_endpoint: string;
  supervisor: string;
  tailscale_node: string;
  routes: RoutePrefix[];
  worker_pool: WorkerPool;
  ollama_endpoint?: string;
  ollama_model?: string;
  keepalive_interval_ms?: number;
}

export interface OllamaConfig {
  endpoint: string;
  model: string;
  timeout_ms?: number;
}

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatResponse {
  content: string;
  model: string;
  done: boolean;
}

export interface SessionState {
  session_token: string | null;
  connected_at: number | null;
  last_keepalive: number | null;
}
