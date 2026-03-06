// src/core/config.ts
import { readFileSync, existsSync } from 'fs';
import { parse } from 'yaml';
import type { GatewayConfig } from '../types/index.js';

const DEFAULTS: GatewayConfig = {
  port:                      7340,
  redis_url:                 'redis://localhost:6379',
  keepalive_interval_ms:     30_000,
  keepalive_miss_threshold:  2,
  keepalive_dead_threshold:  3,
  dns_cache_ttl_s:           300,
  default_confidence_floor:  0.7,
  firewall: {
    enabled:            true,
    pii_patterns:       [],
    injection_patterns: [],
    blocked_prefixes:   ['0.0.0.0/0'],
  },
  claude: {
    api_key:    process.env.ANTHROPIC_API_KEY,
    model:      'claude-sonnet-4-20250514',
    max_tokens: 4096,
  },
  log_level: 'info',
};

export function loadConfig(path?: string): GatewayConfig {
  const configPath = path ?? process.env.GATEWAY_CONFIG ?? './gateway.yaml';

  if (!existsSync(configPath)) {
    return DEFAULTS;
  }

  const raw    = readFileSync(configPath, 'utf-8');
  const parsed = parse(raw) as Partial<GatewayConfig>;

  const merged: GatewayConfig = {
    ...DEFAULTS,
    ...parsed,
    firewall: { ...DEFAULTS.firewall, ...parsed.firewall },
    claude:   { ...DEFAULTS.claude,   ...parsed.claude   },
  };

  // Env var overrides
  if (process.env.PORT) merged.port = parseInt(process.env.PORT, 10);
  if (process.env.REDIS_URL) merged.redis_url = process.env.REDIS_URL;
  if (process.env.LOG_LEVEL) merged.log_level = process.env.LOG_LEVEL as GatewayConfig['log_level'];

  return merged;
}
