# AI-ADR-009: AI Vendor Approval Process

**Status:** Accepted
**Date:** 2026-03-07
**Author:** Ryan / ry-ops.dev

## Context

The Fabric-SDK depends on external AI vendors for specific capabilities. Adding new
AI vendors or models introduces supply chain risk, data handling concerns, and cost
implications. Vendor selection must be deliberate, documented, and auditable.

- **Current vendors:** Anthropic (Claude), OpenAI (embeddings), Ollama (local inference)
- **Security concerns:** Supply chain compromise, data retention policies, vendor lock-in
- **Compliance:** OWASP LLM #3 (supply chain), NIST AI RMF

## Decision

### Approved Vendors

| Vendor | Service | Purpose | Data Sent |
|--------|---------|---------|-----------|
| Anthropic | Claude API | Escalation lane (last resort) | PII-scrubbed queries + context |
| OpenAI | text-embedding-3-small | Embedding generation for AIANA | Resolved query text (truncated) |
| Ollama (self-hosted) | Local LLM inference | Per-fabric reasoning | Fabric-controlled context only |

### Approval Requirements for New AI Vendors

Adding a new AI vendor requires:

1. **AI-ADR** — Document the vendor, model, purpose, data handling, and risks
2. **Data flow analysis** — What data leaves the mesh? What is the vendor's retention policy?
3. **Cost analysis** — Projected usage, pricing model, budget impact
4. **Security review** — API key management, authentication, encryption in transit
5. **Fallback plan** — What happens if the vendor is unavailable?
6. **Human approval** — PR with the AI-ADR must be reviewed and approved

### Prohibited Without Explicit Approval

- New LLM providers (Google, Meta, Mistral, etc.)
- New embedding providers
- AI SaaS platforms (Pinecone, Weaviate, etc. — self-hosted Qdrant is approved)
- AI-powered security scanning services
- Model marketplaces or model registries

## Security Controls

- **Vendor inventory** — approved vendors listed above, maintained in this ADR
- **Data flow documentation** — what data reaches each vendor, documented per AI-ADR
- **API key rotation** — credentials stored in Kubernetes secrets, rotation documented
- **No vendor auto-discovery** — fabrics cannot dynamically connect to new AI services

## Compliance Mapping

| Framework | Control |
|-----------|---------|
| OWASP LLM Top 10 #3 | Supply chain vulnerabilities — vendor approval gate |
| NIST AI RMF — Govern | AI vendor oversight policies |
| NIST AI RMF — Map | Supply chain risks identified per vendor |
| ISO 42001 — AI Governance | Vendor management documented |

## Consequences

**Positive:**
- No shadow AI services — every vendor is documented and approved
- Data flow is explicit — know exactly what leaves the mesh
- Cost predictable — no surprise vendor bills

**Negative:**
- Approval process adds friction to adopting new AI capabilities
- Limited to approved vendors until new AI-ADR is written

## References

- ADR-003 §4: Deployment safety (secrets never in code)
- AI-ADR-001: Secure use of external LLMs
