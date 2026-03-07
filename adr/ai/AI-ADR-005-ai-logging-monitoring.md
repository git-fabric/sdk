# AI-ADR-005: AI Logging and Monitoring

**Status:** Accepted
**Date:** 2026-03-07
**Author:** Ryan / ry-ops.dev

## Context

The Fabric-SDK is an autonomous system that routes queries, calls LLMs, and indexes
knowledge without human intervention. Every decision must be auditable after the fact.
Without structured logging and monitoring, diagnosing routing errors, detecting drift,
or auditing escalation patterns is impossible.

- **Architecture:** Gateway intercepts → DNS resolves → fabric responds → AIANA indexes
- **Security concerns:** Unaudited escalations, silent routing failures, cost overrun
- **Compliance:** NIST AI RMF (Measure/Manage), ISO 42001 (Monitoring)

## Decision

### Audit Log (Persistent in Redis)

Every significant event is logged to `fabric:audit` in Redis with:
- `audit_id` — unique hash for correlation
- `timestamp` — unix timestamp
- `event_type` — register, withdraw, keepalive, dns_resolve, intercept, firewall, escalate
- `fabric_id` — which fabric was involved
- `routing_lane` — deterministic, local-llm, or claude
- `decision` — human-readable routing decision
- `metadata` — additional context (domain_hint, query_hash, source)

Retention: last 10,000 entries (Redis LTRIM).

### Metrics Endpoint (`/metrics`)

Real-time operational metrics derived from the audit log:

| Metric | Description |
|--------|-------------|
| `intercepts.total` | Total intercept count |
| `intercepts.by_lane` | Breakdown by routing lane |
| `intercepts.claude_avoidance_rate` | % of intercepts NOT going to Claude |
| `dns.resolves` | Total DNS resolution count |
| `dns.cache_hit_ratio` | Cache hits / total resolves |
| `registrations.total` | Fabric registration count |
| `firewall.blocks` | Injection/policy block count |
| `fabric_health.active` | Active fabric count |
| `fabric_health.total_routes` | Total route prefixes in F-RIB |

### Log Levels

- **Gateway stdout** — structured log with winston, level configurable via `LOG_LEVEL`
- **Fabric stdout** — each fabric logs registration, keepalive, library hits, errors
- **Audit log** — persistent in Redis, queryable via `/audit?limit=N`

## Security Controls

- **Every intercept audited** — lane, confidence, target fabric, audit_id
- **Every registration audited** — prefixes, AS number, fabric_id
- **Every DNS resolution audited** — source (cache/fabric), routing lane
- **Firewall blocks audited** — injection pattern or PII detection
- **No PII in audit logs** — PII is scrubbed before the audit entry is created

## Compliance Mapping

| Framework | Control |
|-----------|---------|
| OWASP LLM Top 10 #6 | Excessive agency — all actions auditable |
| NIST AI RMF — Measure | Metrics quantify AI system performance |
| NIST AI RMF — Manage | Audit trail enables incident investigation |
| ISO 42001 — Monitoring | Continuous AI system evaluation via metrics |
| ISO 42001 — Transparency | Decision history documented and queryable |

## Consequences

**Positive:**
- Full audit trail for every routing decision
- Real-time metrics for operational visibility
- Claude avoidance rate quantifies cost savings

**Negative:**
- Redis memory usage grows with audit log (mitigated by LTRIM at 10k)
- Metrics derived from audit log — not real-time counters (slight lag)

## References

- Gateway metrics: `packages/gateway/src/mcp/server.ts` (`/metrics` endpoint)
- F-RIB audit: `packages/gateway/src/frib/index.ts` (audit method)
- ADR-003 §5.2: DevSecOps monitoring
