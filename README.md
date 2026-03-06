# Fabric-SDK

A composable framework for autonomous fabric agents. BGP-style routing, local LLM inference, and Claude escalation as the default route of last resort.

## Architecture

```
L7  Worker Agents       -- execute domain tasks, fabric-supervised only
L6  MCP Protocol        -- tool interface contract
L5  AIANA               -- session memory (per-fabric)
L4  Interceptor + DNS   -- path selection, unicast resolution
L3  Gateway             -- F-RIB, route reflector, Redis cache
L2  Firewall            -- policy, injection detection, PII scrub
L1  Tailscale           -- zero-trust transport
```

Claude is `0.0.0.0/0` -- the default route with lowest local preference.

## Packages

| Package | Description |
|---------|-------------|
| [`@fabric-sdk/gateway`](packages/gateway) | BGP-style route reflector. F-RIB, unicast DNS resolver, interceptor, firewall. |
| [`@fabric-sdk/client`](packages/client) | Client library for fabrics. Registration, keepalive, intercept, Ollama integration. |
| [`create-fabric-app`](packages/create-fabric) | CLI to scaffold a new fabric project. |

## Quick Start

### Start the gateway

```bash
npx @fabric-sdk/gateway start --config ./gateway.yaml
```

### Create a new fabric

```bash
npx create-fabric-app my-fabric --as-number 65100
cd my-fabric
npm run dev
```

### Use the client in an existing fabric

```typescript
import { FabricClient } from '@fabric-sdk/client';

const client = new FabricClient({
  gateway_url: 'http://localhost:7340',
  fabric_id: 'git-steer',
  as_number: 65001,
  version: '2.4.1',
  mcp_endpoint: 'http://git-steer:8080/mcp',
  ollama_endpoint: 'http://localhost:11434',
  ollama_model: 'qwen2.5-coder:3b',
  supervisor: 'github-actions',
  tailscale_node: 'git-steer',
  routes: [
    { prefix: 'fabric.cve', local_pref: 100, description: 'CVE remediation' },
    { prefix: 'fabric.github', local_pref: 100, description: 'GitHub lifecycle' },
  ],
  worker_pool: { total: 4, healthy: 4, workers: [] },
});

// Register with gateway, start keepalive
await client.register();
client.startKeepalive();

// Smart query: intercept -> local LLM or Claude
const result = await client.query('Fix CVE-2024-1234 in lodash', 'fabric.cve');
// result.lane = 'deterministic' | 'local-llm' | 'claude'
// result.response = local LLM answer (if local-llm lane)
// result.context = retrieved knowledge (always)

// Cleanup
await client.destroy();
```

## Gateway Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Gateway health + fabric count |
| GET | `/frib` | Full F-RIB + session table |
| GET | `/frib/route/:prefix` | Single prefix lookup |
| POST | `/register` | Fabric registration (ADR-002 S7) |
| POST | `/keepalive` | Fabric keepalive (ADR-002 S11) |
| POST | `/withdraw` | Route withdrawal |
| POST | `/advertise` | New route advertisement |
| POST | `/dns/resolve` | Unicast DNS resolution (ADR-002 S12) |
| POST | `/intercept` | Full path selection (firewall -> DNS -> lane) |
| GET | `/audit` | Audit log |

## Routing Lanes

| Lane | Condition | Handler |
|------|-----------|---------|
| `deterministic` | confidence >= 0.95 | Direct tool execution, no LLM |
| `local-llm` | confidence >= floor | Fabric's Ollama instance |
| `claude` | confidence < floor | Claude API (with context injected) |

## ADRs

- [ADR-001: Fabric-SDK Architecture](docs/adr-001.md)
- [ADR-002: Worker Contract + Registration Protocol](docs/adr-002.md)

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
