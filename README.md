# @fabric-sdk/gateway

BGP-style route reflector for the Fabric-SDK. Provides the F-RIB, unicast DNS resolver, interceptor, and firewall for autonomous fabric agents.

## Architecture (ADR-001)

```
L7  Worker Agents       — execute domain tasks, fabric-supervised only
L6  MCP Protocol        — tool interface contract
L5  AIANA               — session memory (per-fabric)
L4  Interceptor + DNS   — path selection, unicast resolution
L3  Gateway (this)      — F-RIB, route reflector, Redis cache
L2  Firewall            — policy, injection detection, PII scrub
L1  Tailscale           — zero-trust transport
```

Claude is `0.0.0.0/0` — the default route of last resort.

## Quick Start

```bash
npx @fabric-sdk/gateway start --config ./gateway.yaml
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/health`       | Gateway health + fabric count |
| GET  | `/frib`         | Full F-RIB + session table |
| GET  | `/frib/route/:prefix` | Single prefix lookup |
| POST | `/register`     | Fabric registration (ADR-002 §7) |
| POST | `/keepalive`    | Fabric keepalive (ADR-002 §11) |
| POST | `/withdraw`     | Route withdrawal |
| POST | `/advertise`    | New route advertisement |
| POST | `/dns/resolve`  | Unicast DNS resolution (ADR-002 §12) |
| POST | `/intercept`    | Full path selection (firewall → DNS → lane) |
| GET  | `/audit`        | Audit log |

## Fabric Registration

```typescript
// From any fabric — call on startup
const response = await fetch('http://gateway:7340/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fabric_id:      'git-steer',
    as_number:      65001,
    version:        '2.4.1',
    mcp_endpoint:   'http://git-steer.fabric.svc:8080/mcp',
    ollama_endpoint: 'http://git-steer.fabric.svc:11434',
    ollama_model:   'qwen2.5-coder:3b',
    supervisor:     'github-actions',
    tailscale_node: 'git-steer',
    worker_pool: {
      total: 4, healthy: 4,
      workers: [
        { worker_id: 'git-steer.cve-scanner.01', status: 'healthy' }
      ]
    },
    routes: [
      { prefix: 'fabric.cve',    local_pref: 100, description: 'CVE remediation' },
      { prefix: 'fabric.github', local_pref: 100, description: 'GitHub lifecycle' },
    ]
  })
});
const { session_token } = await response.json();
```

## Routing Lanes

| Lane | Condition | Handler |
|------|-----------|---------|
| `deterministic` | confidence ≥ 0.95 | Direct tool execution, no LLM |
| `local-llm`     | confidence ≥ floor | Fabric's Ollama instance |
| `claude`        | confidence < floor | Claude API (with context injected) |

## OSI References

- ADR-001: [Fabric-SDK Architecture](https://github.com/ry-ops/fabric-sdk/docs/adr-001.docx)
- ADR-002: [Worker Contract + Registration Protocol](https://github.com/ry-ops/fabric-sdk/docs/adr-002.docx)
