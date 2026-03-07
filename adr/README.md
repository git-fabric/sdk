# Architecture Decision Records

## Structure

```
adr/
  ADR-001-fabric-sdk-architecture.md      # Framework architecture
  ADR-002-worker-contract-registration.md # Worker contract & registration protocol
  ADR-003-guardrails.md                   # Development guardrails & safety model
  ai/
    AI-ADR-001-secure-use-of-external-llms.md     # Claude API usage policy
    AI-ADR-002-prompt-injection-mitigation.md      # Multi-layer injection defense
    AI-ADR-003-ai-data-classification-redaction.md # PII scrubbing & data classification
    AI-ADR-004-llm-output-validation.md            # Confidence scoring & read-only defaults
    AI-ADR-005-ai-logging-monitoring.md            # Audit log, metrics, observability
    AI-ADR-006-agent-permission-boundaries.md      # Least privilege, domain isolation
    AI-ADR-007-vector-database-security.md         # Qdrant security, librarian model
    AI-ADR-008-ai-model-access-control.md          # Model access & API key management
    AI-ADR-009-ai-vendor-approval.md               # Vendor approval process
    AI-ADR-010-ai-incident-response.md             # AI-specific incident procedures
    AI-ADR-011-development-compliance.md           # Change requests, PRs, deployment governance
```

## Governance Frameworks

These ADRs align with:

- **OWASP Top 10 for LLM Applications** — prompt injection, data disclosure, excessive agency
- **NIST AI Risk Management Framework** — Govern, Map, Measure, Manage
- **ISO/IEC 42001 AI Management Systems** — governance, risk, data, transparency, monitoring

## Compliance Coverage

| OWASP LLM Risk | AI-ADR |
|----------------|--------|
| #1 Prompt Injection | AI-ADR-002 |
| #2 Sensitive Information Disclosure | AI-ADR-003 |
| #3 Supply Chain Vulnerabilities | AI-ADR-009 |
| #4 Data and Model Poisoning | AI-ADR-007 |
| #5 Improper Output Handling | AI-ADR-004 |
| #6 Excessive Agency | AI-ADR-006 |
| #7 System Prompt Leakage | AI-ADR-002 |
| #8 Vector and Embedding Weaknesses | AI-ADR-007 |
| #9 Misinformation | AI-ADR-004 |
| #10 Unbounded Consumption | AI-ADR-001, AI-ADR-008 |

## Adding New ADRs

1. Use the next sequential number (ADR-004, AI-ADR-012, etc.)
2. Follow the template: Context, Decision, Security Controls, Compliance Mapping, Consequences
3. Create a branch, open a PR (see AI-ADR-011)
4. Human approval required before merge
