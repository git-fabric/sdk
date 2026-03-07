# ADR-002: Worker Contract & Fabric Registration Protocol

**Status:** Accepted
**Date:** 2026-03-01
**Author:** Ryan / ry-ops.dev
**Depends On:** ADR-001

## Context

The Fabric-SDK requires a formal contract for worker agents and a registration
protocol for how fabrics announce themselves to the gateway. Without these contracts,
architectural drift is inevitable — workers bypass fabrics, fabrics bypass the gateway,
and the routing model collapses.

The Worker Contract derives from the Cortex k8s Job failure mode: Jobs have no state
persistence, unacceptable scheduling latency, and no parent-child communication.
git-steer resolved this by using GitHub as the external supervisor.

## Decision

### Worker Contract

Every worker communicates ONLY with its parent fabric via MCP (L6). Never with the
gateway, peer fabrics, Claude, or other workers directly.

Worker classifications:
- **Reactive** — Event-driven, cold-start within 2 seconds
- **Proactive** — Scheduled/polling, latency tolerant
- **Stateful** — Long-running, multi-step, context-preserving

Every worker must produce a durable work unit (PR, record, workflow run) that survives
process death.

### Fabric Registration Protocol

BGP-equivalent session establishment + route advertisement:

1. CONNECT — Authenticated session over Tailscale mesh
2. IDENTIFY — fabric_id, AS number, MCP endpoint, version
3. ADVERTISE — Knowledge prefixes, confidence baseline, worker pool status
4. ACKNOWLEDGE — Gateway validates, inserts into F-RIB, returns session token
5. KEEPALIVE — Every 30 seconds. 3 missed = route withdrawal
6. UPDATE — Worker pool health changes
7. WITHDRAW — Graceful shutdown or capability loss

### Prohibited Patterns

- k8s Jobs as worker primitives
- Workers communicating directly with gateway or peer fabrics
- Workers calling Claude directly
- Shared mutable state between workers
- In-memory-only work unit state

## References

- Full specification: `docs/adr-002.md` (original format)
- ADR-001: Fabric-SDK Architecture
