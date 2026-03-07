# AI-ADR-003: AI Data Classification and Redaction

**Status:** Accepted
**Date:** 2026-03-07
**Author:** Ryan / ry-ops.dev

## Context

Fabric queries may contain sensitive data — PII, credentials, API keys. This data
must never reach external LLMs (Claude) or be stored in shared memory (Qdrant).
The Fabric-SDK handles data from multiple domains (k8s cluster state, DNS records,
VM hypervisor data) where secrets are routinely present.

- **Data sources:** User queries, cluster API responses, library docs, AIANA memories
- **Security concerns:** PII leakage to external API, credential exposure in audit logs
- **Compliance:** OWASP LLM #2 (sensitive info disclosure), NIST AI RMF

## Decision

The L2 firewall scrubs PII from all queries before routing. Scrubbing replaces
detected patterns with `[REDACTED]` — the query continues with redacted content,
it is not blocked.

### Data Classification

| Classification | Treatment | Example |
|---------------|-----------|---------|
| **PII** | Scrub before routing | SSN, credit card numbers, email addresses |
| **Credentials** | Scrub before routing | API keys, tokens, passwords |
| **Cluster state** | Allow — operational data | Pod names, node IPs, deployment status |
| **Library content** | Allow — public reference docs | k3s docs, Proxmox API docs |
| **AIANA memories** | Allow — organic knowledge | Resolved query context, feedback loop entries |

### Redaction Patterns

- SSN: `\b\d{3}-\d{2}-\d{4}\b`
- Credit card: `\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b`
- Email: `\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b`
- Passwords: `\bpassword\s*[:=]\s*\S+`
- API keys: `\bapi[_-]?key\s*[:=]\s*\S+`
- Tokens: `\btoken\s*[:=]\s*['"]\S+['"]`
- GitHub PAT: `ghp_[a-zA-Z0-9]{36}`
- OpenAI key: `sk-[a-zA-Z0-9]{48}`

## Security Controls

- **Scrub, don't block** — PII detection triggers redaction, not rejection. The query
  is still useful after scrubbing.
- **Audit on detection** — Every PII detection logged with audit_id (not the PII itself)
- **Pre-routing scrub** — PII is removed before the query reaches any fabric or LLM
- **AIANA truncation** — Feedback loop entries truncated at 4000 chars before indexing
- **Library file cap** — Reference docs capped at 6 files / 8000 chars each

## Compliance Mapping

| Framework | Control |
|-----------|---------|
| OWASP LLM Top 10 #2 | Sensitive information disclosure — PII scrubbed pre-routing |
| NIST AI RMF — Govern | Data classification policy documented |
| NIST AI RMF — Manage | Redaction patterns configurable without code changes |
| ISO 42001 — Data Management | Responsible data usage — PII never reaches external APIs |

## Consequences

**Positive:**
- PII never reaches Claude or any external service
- Scrubbing is transparent — queries continue with redacted values
- Configurable patterns — extend via gateway config

**Negative:**
- Regex-based detection has false positive risk (e.g., phone numbers matching SSN pattern)
- Novel PII formats not in pattern library will pass through
- Redaction may remove context needed for accurate answers

## References

- Gateway firewall: `packages/gateway/src/firewall/index.ts`
- ADR-003 §3.2: Sandboxing and domain isolation
