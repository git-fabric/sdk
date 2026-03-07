# AI-ADR-001: Secure Use of External LLM APIs

**Status:** Accepted
**Date:** 2026-03-07
**Author:** Ryan / ry-ops.dev

## Context

The Fabric-SDK uses Claude (Anthropic) as the external LLM for the escalation lane —
queries that no fabric or local model can resolve. Claude is treated as an eBGP peer:
external, different trust level, metered, and firewall-enforced.

- **AI model type:** Claude (claude-sonnet-4-20250514), accessed via Anthropic API
- **Data sources:** Aggregated context from fabric knowledge bases, pre-injected before escalation
- **Security concerns:** Data leakage to external API, cost overrun, dependency on external service
- **Compliance requirements:** No PII sent to Claude, all escalations audited

## Decision

Claude is the `0.0.0.0/0` default route with the lowest local preference. It is the
last resort, not the first option. The three-lane routing model (deterministic →
local-llm → claude) structurally minimizes Claude API calls.

All Claude-bound traffic passes through the L2 firewall for PII scrubbing and prompt
injection detection before leaving the mesh.

## Security Controls

- **PII scrubbing** — Firewall strips SSNs, credit cards, API keys, passwords before any
  external API call (ADR-003 §3.2)
- **Prompt injection detection** — Regex-based pattern matching on all queries before routing
- **API key isolation** — Claude API key stored in Kubernetes secrets, never in code
- **Cost containment** — Three-lane routing ensures 84%+ of queries never reach Claude
- **Audit trail** — Every escalation logged with query hash, confidence, routing lane, audit_id
- **Context truncation** — AIANA feedback loop truncates at 4000 chars before indexing

## Compliance Mapping

| Framework | Control |
|-----------|---------|
| OWASP LLM Top 10 #2 | Sensitive information disclosure — PII scrubbed before escalation |
| OWASP LLM Top 10 #6 | Excessive agency — Claude cannot take actions, only provide answers |
| OWASP LLM Top 10 #10 | Unbounded consumption — three-lane routing limits API usage |
| NIST AI RMF — Govern | Claude usage policy defined in ADR-001, enforced by gateway |
| NIST AI RMF — Manage | Metrics endpoint tracks Claude avoidance rate |

## Alternatives Considered

- **Claude as primary** — All queries go to Claude. Rejected: cost prohibitive, no local learning.
- **No external LLM** — Ollama only. Rejected: 3B models insufficient for novel/complex queries.
- **OpenAI instead of Claude** — Rejected: Anthropic API is the team's standard.

## Consequences

**Positive:**
- Claude costs trend toward zero as AIANA feedback loop indexes resolutions
- PII never leaves the mesh
- Full audit trail on every escalation

**Negative:**
- Anthropic API dependency for the escalation lane
- Claude answers are NOT indexed as fabric knowledge (prevents circular dependency)

## References

- ADR-001 §4.2: Request lifecycle
- ADR-003 §7: Cost-conscious design
- OWASP Top 10 for LLM Applications: https://owasp.org/www-project-top-10-for-large-language-model-applications/
