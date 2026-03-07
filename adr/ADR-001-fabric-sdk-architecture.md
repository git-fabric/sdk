# ADR-001: Fabric-SDK Composable Framework for Autonomous Fabric Agents

**Status:** Accepted
**Date:** 2026-03-01
**Author:** Ryan / ry-ops.dev
**Supersedes:** None — inaugural framework ADR
**Related:** ADR-002, ADR-003, AI-ADR-001 through AI-ADR-010

## Context

Over the past 18 months, a series of infrastructure automation projects — Cortex,
git-steer, AIANA, FABRIC/SOCIAL, and gitops-alert-resolver — independently converged
on the same architectural pattern: a self-contained service with its own memory,
tooling, and escalation path. Each was built domain-first, solving real operational
problems before any framework was identified.

The Fabric-SDK is the extraction of that pattern into a reusable framework. It is not
a greenfield design — it is the documentation of what was already proven to work, made
deliberately repeatable.

Key constraints:
- No GPU — local inference runs on CPU (Ollama, quantized 3B-7B models)
- Self-hosted-first — Tailscale mesh as the zero-trust transport layer
- Claude as a metered resource — escalation only when no fabric can answer
- Each fabric must be independently deployable without gateway dependency

## Decision

We adopt the Fabric-SDK as the standard framework for all autonomous agent services.

Standard fabric stack:
- **MCP Server** — Domain tool interface and external contract
- **AIANA + Qdrant** — Semantic memory, retrieval, and session continuity
- **Ollama (local LLM)** — CPU-based local inference for ambiguous-but-bounded tasks
- **Redis** — Route cache, task bus, and session state
- **Worker agents** — Domain-specific executors using external supervisors
- **Claude escalation** — Last-resort routing when no fabric or local model can resolve

Each fabric is an Autonomous System (AS) in the BGP-style routing model.

## OSI Layer Mapping

| Layer | OSI Name | Fabric-SDK Component | Responsibility |
|-------|----------|---------------------|----------------|
| L7 | Application | Worker Agents | Execute domain tasks. Supervised by external systems. |
| L6 | Presentation | MCP Protocol | Serialization, schema, tool contracts. |
| L5 | Session | AIANA | Conversation state, memory continuity. |
| L4 | Transport | Interceptor + DNS | Path selection, unicast resolution, routing decisions. |
| L3 | Network | Gateway | BGP-style route reflector. F-RIB, Redis cache. |
| L2 | Data Link | Firewall | Policy enforcement, injection detection, PII scrubbing. |
| L1 | Physical | Tailscale | Zero-trust transport, mTLS, k3s mesh. |

## Three-Lane Routing

1. **Deterministic** (>=0.95) — Known pattern, known resolution. No LLM required.
2. **Local-LLM** (>=floor) — Pattern partially matched. Ollama synthesizes with context.
3. **Claude** (<floor) — No pattern match. Routes to Claude with all context pre-injected.

## Consequences

### Positive
- Every new fabric starts 80% complete — stack is pre-wired
- Claude API costs reduced structurally — deterministic tasks never escalate
- Routing decisions are deterministic and auditable
- Knowledge accumulates — AIANA indexes every resolution

### Negative
- Per-fabric Ollama instance increases resource footprint on CPU-only homelab
- Confidence threshold tuning required per fabric
- External supervisor dependency (GitHub) for worker lanes

## References

- Full architecture specification: `docs/adr-001.md` (original format)
- ADR-002: Worker Contract & Registration Protocol
- ADR-003: Development Guardrails & Safety Model
