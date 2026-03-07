# AI-ADR-002: Prompt Injection Mitigation Strategy

**Status:** Accepted
**Date:** 2026-03-07
**Author:** Ryan / ry-ops.dev

## Context

Prompt injection is the #1 risk in the OWASP Top 10 for LLM Applications. In the
Fabric-SDK, queries flow through multiple layers — firewall, interceptor, DNS resolver,
fabric MCP handlers — before reaching any LLM. Each layer is a potential injection point.

- **AI model type:** Ollama (local, per-fabric) and Claude (external, escalation)
- **Architecture:** Queries enter via `/intercept` or `/dns/resolve`, pass through L2 firewall
- **Security concerns:** Malicious prompts could bypass routing, escalate privileges, or exfiltrate data
- **Compliance:** OWASP LLM #1, NIST AI RMF

## Decision

Defense in depth — prompt injection is blocked at multiple layers:

1. **L2 Firewall (structured matching)** — Regex-based pattern detection runs on every
   query BEFORE routing. This is not LLM interpretation — it operates on structured
   data. Cannot be prompt-injected because it doesn't use an LLM to make decisions.

2. **Fabric MCP handlers (keyword matching)** — The `aiana_query` handler uses keyword
   matching and regex to decide which tool to call. Not LLM-interpreted.

3. **Ollama context isolation** — Local LLM operates on pre-fetched library content
   that the fabric controls. User-supplied prompts are not passed directly to Ollama.

4. **Domain isolation** — Each fabric only processes queries in its own domain. A prompt
   injection targeting k8s commands has no effect on the Proxmox fabric.

## Security Controls

- **Injection pattern library** — Default patterns detect: "ignore previous instructions",
  "forget everything", "pretend to be", "jailbreak", "act as unrestricted", script tags,
  exec/eval/system calls
- **Configurable patterns** — Additional patterns added via gateway config without code changes
- **400 response on detection** — Blocked queries return HTTP 400 with audit_id, never reach fabrics
- **Audit logging** — Every injection attempt logged with pattern match and audit_id
- **No LLM in the decision path** — Routing decisions use regex, keyword matching, and
  confidence scores. The firewall cannot be prompt-injected.

## Compliance Mapping

| Framework | Control |
|-----------|---------|
| OWASP LLM Top 10 #1 | Prompt injection — multi-layer defense, no LLM in routing path |
| OWASP LLM Top 10 #7 | System prompt leakage — system prompts not exposed via MCP |
| NIST AI RMF — Map | Injection risks identified and mitigated at each layer |
| NIST AI RMF — Measure | Firewall blocks tracked in `/metrics` endpoint |

## Alternatives Considered

- **LLM-based injection detection** — Use a classifier model to detect injections.
  Rejected: circular dependency (using an LLM to protect an LLM), latency, cost.
- **No detection** — Trust fabric isolation alone. Rejected: defense in depth is required.

## Consequences

**Positive:**
- Zero false negatives on known injection patterns
- No latency impact — regex matching is sub-millisecond
- Detection cannot itself be prompt-injected

**Negative:**
- Regex patterns require maintenance as new injection techniques emerge
- Novel injection patterns not in the library will pass through
- Legitimate queries containing pattern substrings may be falsely blocked

## References

- Gateway firewall: `packages/gateway/src/firewall/index.ts`
- ADR-003 §6.4: Prompt injection defense
- OWASP LLM Top 10 #1: https://owasp.org/www-project-top-10-for-large-language-model-applications/
