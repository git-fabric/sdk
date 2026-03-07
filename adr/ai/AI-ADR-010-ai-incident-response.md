# AI-ADR-010: AI Incident Response Procedures

**Status:** Accepted
**Date:** 2026-03-07
**Author:** Ryan / ry-ops.dev

## Context

AI systems fail in ways traditional software does not — hallucination, confidence
drift, prompt injection bypass, model poisoning, and circular knowledge amplification.
These failures may be subtle (gradually degrading answer quality) rather than obvious
(crash/error). The Fabric-SDK needs incident response procedures specific to AI
failure modes.

- **Failure modes:** Hallucination, confidence drift, injection bypass, stale knowledge,
  circular indexing, cost runaway
- **Detection:** Audit logs, metrics endpoint, manual observation
- **Compliance:** NIST AI RMF (Manage), ISO 42001 (Monitoring)

## Decision

### AI-Specific Incident Categories

| Category | Indicators | Severity |
|----------|-----------|----------|
| **Prompt injection bypass** | Injection pattern in audit log without block | Critical |
| **Confidence drift** | Fabric returning lower confidence over time | Medium |
| **Circular indexing** | Claude answers appearing in AIANA memory | High |
| **Cost runaway** | Claude avoidance rate dropping significantly | High |
| **Route hijacking** | Fabric advertising prefixes outside its domain | Critical |
| **Stale knowledge** | Library docs returning outdated information | Low |
| **Model poisoning** | AIANA memories containing incorrect/malicious content | High |

### Response Procedures

**Critical — Immediate Action:**
1. Withdraw affected fabric's routes: `POST /withdraw`
2. Check audit log: `GET /audit?limit=100`
3. Identify the injection/hijack pattern
4. Update firewall patterns if injection bypass
5. Restart affected fabric after fix
6. Document in change log, create ADR amendment if needed

**High — Investigate and Fix:**
1. Check metrics: `GET /metrics` — look for anomalies in lane distribution
2. Review AIANA memories for circular/poisoned entries
3. Delete specific memories via `aiana_memory_delete` if poisoned
4. Adjust confidence thresholds if drift detected
5. Document findings, update relevant AI-ADR

**Medium/Low — Monitor and Plan:**
1. Note in change log
2. Track over multiple observation periods
3. Address in next planned maintenance window

### Kill Switches

- **Withdraw all routes:** Gateway can withdraw any fabric's routes immediately
- **Flush DNS cache:** Restart gateway (DNS-002 flushes on startup)
- **Clear AIANA memories:** `aiana_memory_delete` by ID or bulk
- **Disable firewall:** `firewall.enabled: false` in config (emergency only)
- **Block fabric:** Add fabric's prefixes to `blocked_prefixes` in config

## Security Controls

- **Audit trail** — every incident leaves a trail in `fabric:audit`
- **Metrics alerting** — Claude avoidance rate drop = cost incident signal
- **Route withdrawal** — immediate isolation of misbehaving fabric
- **Memory cleanup** — poisoned AIANA entries deletable by ID

## Compliance Mapping

| Framework | Control |
|-----------|---------|
| NIST AI RMF — Manage | Incident response procedures documented |
| NIST AI RMF — Measure | Metrics detect anomalies before they escalate |
| ISO 42001 — Monitoring | Continuous evaluation with defined response |
| ISO 42001 — Risk Management | Incident categories and severities defined |

## Consequences

**Positive:**
- AI-specific incidents have documented response procedures
- Kill switches enable immediate containment
- Audit trail supports post-incident investigation

**Negative:**
- Subtle failures (confidence drift) may not trigger alerts
- No automated anomaly detection yet (future enhancement)
- Manual observation required for some incident types

## References

- ADR-003 §5: Secure agent architecture
- ADR-003 §6.5: Monitor and revoke
- Gateway metrics: `GET /metrics`
- Gateway audit: `GET /audit`
