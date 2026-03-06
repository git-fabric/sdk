# Fabric-SDK

**Stop paying Claude to answer questions your own systems already know.**

The fabric ecosystem -- git-steer, FABRIC/SOCIAL, AIANA, and others -- has accumulated a significant knowledge base across Qdrant collections, Redis state, and indexed outcomes. Every time Claude is asked something that's already in that knowledge base, API credits are burned for what is essentially a lookup operation.

The Fabric-SDK is the routing layer that makes that decision: does the fabric already know this, or does it genuinely need Claude? The BGP model, the three-lane routing, the DNS resolution -- all in service of one thing: Claude only gets called when nobody else can answer.

The system gets smarter over time. Every time Claude does get called, AIANA indexes the outcome. Next time the same pattern comes up, it routes locally. The Claude escalation rate trends toward zero for known problem domains.

A proof-of-concept framework built on the success of cortex, git-fabric, and fabric-forge.

## Network Topology

Each fabric is a self-contained autonomous system -- MCP server, AIANA memory, local LLM, and workers. Fabrics operate independently. The gateway is optional connective tissue for cross-fabric resolution; it is not a dependency.

```
                    Claude (eBGP upstream / AS65000 / transit provider)
                       |
                  +----+----+
                  | Firewall| (L2 - border router / policy enforcement)
                  +----+----+
                       |
    +------------------+------------------+
    |          Gateway (Route Reflector)   |
    |   - Fabric RIB                      |
    |   - Interceptor (path selection)    |
    |   - DNS (unicast resolution)        |
    |   - Redis (route cache)             |
    +--------+----------+----------+------+
             |          |          |
    +--------+--+ +-----+----+ +--+--------+
    | Fabric    | | Fabric   | | Fabric    |  (autonomous systems)
    | git-steer | | SOCIAL   | | n8n       |
    | AS65001   | | AS65002  | | AS65004   |
    |           | |          | |           |
    | +-------+ | | +------+ | | +-------+ |
    | | MCP   | | | | MCP  | | | | MCP   | |
    | +-------+ | | +------+ | | +-------+ |
    | | AIANA | | | | AIANA| | | | AIANA | |
    | +-------+ | | +------+ | | +-------+ |
    | | LLM   | | | | LLM  | | | | LLM   | |
    | +-------+ | | +------+ | | +-------+ |
    +--------+--+ +-----+----+ +--+--------+
             |          |          |
    +--------+--+ +-----+----+ +--+--------+
    |  Workers  | | Workers  | |  Workers  |  (L7 / end hosts)
    +--------+--+ +-----+----+ +--+--------+
```

## BGP Routing Example

```
worker finds CVE
  -> reports to git-steer fabric (internal, no routing needed)
  -> git-steer checks local LLM + AIANA
      -> known pattern? resolve locally, worker executes
      -> unknown? git-steer queries gateway DNS
          -> gateway checks RIB
              -> another fabric knows? unicast, retrieve context
              -> nobody knows? default route -> Claude
  -> resolution flows back down to worker
  -> worker executes
```

## Fabric-SDK OSI Model

```
Layer 7 - Application    | Fabric apps (git-steer, FABRIC/SOCIAL, etc.)
Layer 6 - Presentation   | MCP protocol (serialization, schema, tool contracts)
Layer 5 - Session        | AIANA (conversation state, memory continuity)
Layer 4 - Transport      | Interceptor + DNS resolver (routing decisions, unicast dispatch)
Layer 3 - Network        | Gateway (topology, fabric registry, resolution cache)
Layer 2 - Data Link      | Firewall (policy enforcement, prompt injection, PII, auth)
Layer 1 - Physical       | Tailscale (zero trust transport, k3s mesh)
```

Claude is `0.0.0.0/0` -- the default route with lowest local preference.

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| [`@fabric-sdk/gateway`](packages/gateway) | BGP-style route reflector. F-RIB, unicast DNS resolver, interceptor, firewall. | Scaffold complete |
| [`@fabric-sdk/client`](packages/client) | Client library for fabrics. Registration, keepalive, intercept, Ollama integration. | Scaffold complete |
| [`create-fabric-app`](packages/create-fabric) | CLI to scaffold a new fabric project with templates. | Scaffold complete |
| [`@fabric-sdk/fabric-aiana`](packages/fabric-aiana) | Semantic memory fabric. Qdrant-backed, 11 MCP tools, AS65005. | Scaffold complete |

## Project Status

### Phase 1 -- Spec: COMPLETE
- [x] ADR-001: Framework architecture, OSI mapping, BGP routing model
- [x] ADR-002: Worker contract, fabric registration protocol, F-RIB spec

### Phase 2 -- Scaffold: COMPLETE
- [x] Gateway skeleton: F-RIB, registration, keepalive, DNS resolver, interceptor, firewall, audit log
- [x] Client library: FabricClient, SessionManager, OllamaProvider
- [x] `create-fabric-app` CLI with project templates
- [x] Monorepo structure with workspaces, shared tsconfig, vitest
- [x] Tests: firewall, F-RIB, interceptor, client, Ollama provider

### Phase 3 -- Validate: UP NEXT
- [ ] Integration testing: gateway + Redis + test fabric, full intercept -> DNS -> route -> respond flow
- [ ] Metrics: Claude escalation rate, local hit rate, routing latency
- [ ] Threshold tuning: adjust confidence thresholds based on real routing data
- [ ] AIANA feedback loop: resolved Claude answers indexed back into fabric knowledge base

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

- [ADR-001: Fabric-SDK Architecture](docs/adr-001.md) -- OSI mapping, BGP routing, worker model, inference lanes
- [ADR-002: Worker Contract + Registration Protocol](docs/adr-002.md) -- F-RIB, DNS resolution, keepalive, conflict rules

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
