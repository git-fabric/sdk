// FabricClient -- the SDK any fabric imports to register with the gateway,
// maintain keepalive, resolve DNS, intercept requests, and route to local LLM

import axios, { type AxiosInstance } from 'axios';
import { SessionManager } from './session.js';
import { OllamaProvider } from './ollama/provider.js';
import type {
  FabricClientConfig,
  InterceptorResult,
  DNSResponse,
  RoutePrefix,
  WorkerPool,
  OllamaChatMessage,
  OllamaChatResponse,
} from './types.js';

export class FabricClient {
  private config: FabricClientConfig;
  private session: SessionManager;
  private http: AxiosInstance;
  private ollama: OllamaProvider | null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: FabricClientConfig) {
    this.config = config;
    this.session = new SessionManager();
    this.http = axios.create({
      baseURL: config.gateway_url,
      timeout: 10_000,
      headers: { 'Content-Type': 'application/json' },
    });

    this.ollama = config.ollama_endpoint
      ? new OllamaProvider({
          endpoint: config.ollama_endpoint,
          model: config.ollama_model ?? 'qwen2.5-coder:3b',
        })
      : null;
  }

  // ── Registration ────────────────────────────────────────────────

  async register(): Promise<string> {
    const resp = await this.http.post('/register', {
      fabric_id: this.config.fabric_id,
      as_number: this.config.as_number,
      version: this.config.version,
      mcp_endpoint: this.config.mcp_endpoint,
      ollama_endpoint: this.config.ollama_endpoint,
      ollama_model: this.config.ollama_model,
      supervisor: this.config.supervisor,
      tailscale_node: this.config.tailscale_node,
      worker_pool: this.config.worker_pool,
      routes: this.config.routes,
    });

    const { session_token } = resp.data;
    this.session.refresh(session_token);
    return session_token;
  }

  // ── Keepalive ───────────────────────────────────────────────────

  startKeepalive(): void {
    if (this.keepaliveTimer) return;

    const interval = this.config.keepalive_interval_ms ?? 30_000;
    this.keepaliveTimer = setInterval(async () => {
      try {
        await this.keepalive();
      } catch {
        // Session expired -- re-register
        try {
          await this.register();
        } catch {
          // Gateway unreachable -- will retry next interval
        }
      }
    }, interval);
  }

  stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  async keepalive(workerPool?: WorkerPool): Promise<void> {
    const token = this.session.token;
    if (!token) throw new Error('No active session -- call register() first');

    const resp = await this.http.post('/keepalive', {
      fabric_id: this.config.fabric_id,
      session_token: token,
      worker_pool: workerPool ?? this.config.worker_pool,
      timestamp: Math.floor(Date.now() / 1000),
    });

    if (resp.status === 401) {
      this.session.clear();
      throw new Error('Session expired');
    }

    this.session.recordKeepalive();
  }

  // ── Route management ────────────────────────────────────────────

  async advertise(routes: RoutePrefix[]): Promise<void> {
    const token = this.session.token;
    if (!token) throw new Error('No active session');

    await this.http.post('/advertise', {
      fabric_id: this.config.fabric_id,
      session_token: token,
      action: 'advertise',
      routes,
    });
  }

  async withdraw(prefixes?: string[]): Promise<void> {
    const token = this.session.token;
    if (!token) return;

    await this.http.post('/withdraw', {
      fabric_id: this.config.fabric_id,
      session_token: token,
      action: 'withdraw',
      routes: prefixes?.map((p) => ({ prefix: p, local_pref: 0, description: '' })),
    });
  }

  // ── DNS resolution ──────────────────────────────────────────────

  async resolve(queryText: string, domainHint?: string): Promise<DNSResponse> {
    const resp = await this.http.post('/dns/resolve', {
      query_text: queryText,
      domain_hint: domainHint,
      requestor_fabric_id: this.config.fabric_id,
    });

    return resp.data as DNSResponse;
  }

  // ── Intercept (full path selection) ─────────────────────────────

  async intercept(queryText: string, domainHint?: string): Promise<InterceptorResult> {
    const resp = await this.http.post('/intercept', {
      query_text: queryText,
      domain_hint: domainHint,
      requestor_fabric_id: this.config.fabric_id,
    });

    return resp.data as InterceptorResult;
  }

  // ── Local LLM (Ollama) ─────────────────────────────────────────

  async inferLocal(
    messages: OllamaChatMessage[],
    context?: string,
  ): Promise<OllamaChatResponse | null> {
    if (!this.ollama) return null;

    if (context) {
      messages = [
        { role: 'system', content: `Context from fabric knowledge base:\n\n${context}` },
        ...messages,
      ];
    }

    return this.ollama.chat(messages);
  }

  async isOllamaAvailable(): Promise<boolean> {
    return this.ollama?.isAvailable() ?? false;
  }

  // ── Smart route: intercept → local LLM or context passthrough ──

  async query(
    queryText: string,
    domainHint?: string,
  ): Promise<{
    lane: string;
    response?: string;
    context?: string;
    confidence: number;
  }> {
    const result = await this.intercept(queryText, domainHint);

    if (result.lane === 'local-llm' && this.ollama && result.context) {
      const llmResp = await this.inferLocal(
        [{ role: 'user', content: queryText }],
        result.context,
      );

      if (llmResp) {
        return {
          lane: 'local-llm',
          response: llmResp.content,
          context: result.context,
          confidence: result.confidence,
        };
      }
    }

    // Deterministic or claude lane -- return context for caller to handle
    return {
      lane: result.lane,
      context: result.context,
      confidence: result.confidence,
    };
  }

  // ── Health ──────────────────────────────────────────────────────

  async health(): Promise<Record<string, unknown>> {
    const resp = await this.http.get('/health');
    return resp.data;
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  async destroy(): Promise<void> {
    this.stopKeepalive();
    try {
      await this.withdraw();
    } catch {
      // Best effort
    }
    this.session.clear();
  }

  get fabricId(): string {
    return this.config.fabric_id;
  }

  get sessionToken(): string | null {
    return this.session.token;
  }
}
