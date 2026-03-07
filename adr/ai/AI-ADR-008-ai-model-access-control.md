# AI-ADR-008: AI Model Access Control

**Status:** Accepted
**Date:** 2026-03-07
**Author:** Ryan / ry-ops.dev

## Context

The Fabric-SDK uses two classes of AI models: local (Ollama) and external (Claude).
Access to these models must be controlled to prevent unauthorized usage, cost overrun,
and prompt injection via model endpoints.

- **Local model:** Ollama (qwen2.5-coder:3b) — per-fabric, CPU inference
- **External model:** Claude (claude-sonnet-4-20250514) — API key, metered
- **Embedding model:** OpenAI text-embedding-3-small — API key, metered
- **Security concerns:** Unauthorized model access, API key exposure, cost overrun

## Decision

### Local Model (Ollama)

- Per-fabric Ollama instance — each fabric has its own
- In-cluster only — Ollama not exposed outside the k3s mesh
- Workers do NOT call Ollama directly — they ask the fabric, which decides the lane
- No GPU — CPU inference on quantized 3B-7B models
- Model selection is per-fabric, not per-query

### External Model (Claude)

- API key stored in Kubernetes secrets (`claude-api-key`)
- Only the gateway can call Claude — fabrics and workers never call Claude directly
- All Claude-bound traffic passes through the L2 firewall
- Claude is the default route (`0.0.0.0/0`) with lowest local preference
- Three-lane routing structurally minimizes Claude calls

### Embedding Model (OpenAI)

- API key stored in Kubernetes secrets (`aiana-secrets`)
- Only AIANA calls the embedding API — no other fabric generates embeddings
- Used only for organic memory indexing (feedback loop), not for reference docs
- Model: `text-embedding-3-small` — cheapest that meets quality requirements

## Security Controls

- **API keys in secrets** — never in code, environment variables from secret mounts only
- **Gateway-mediated escalation** — no fabric can bypass the gateway to reach Claude
- **Per-fabric model isolation** — each Ollama instance serves one fabric
- **Rate limiting** — gateway keepalive/reaper prevents runaway model calls
- **Cost tracking** — Claude avoidance rate tracked in `/metrics`

## Compliance Mapping

| Framework | Control |
|-----------|---------|
| OWASP LLM Top 10 #10 | Unbounded consumption — three-lane routing limits API usage |
| NIST AI RMF — Govern | Model access policies defined and enforced |
| ISO 42001 — AI Governance | Model selection documented per fabric |

## Consequences

**Positive:**
- No unauthorized model access — all paths mediated by fabric or gateway
- API key exposure limited to secret mounts
- Cost predictable — Claude only for escalation lane

**Negative:**
- Per-fabric Ollama increases resource footprint
- CPU inference is slow compared to GPU — acceptable for async routing

## References

- ADR-001 §7: Local inference layer
- ADR-003 §7: Cost-conscious design
