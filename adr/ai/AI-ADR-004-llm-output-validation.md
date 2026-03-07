# AI-ADR-004: LLM Output Validation Layer

**Status:** Accepted
**Date:** 2026-03-07
**Author:** Ryan / ry-ops.dev

## Context

LLM outputs — from both Ollama (local) and Claude (external) — are non-deterministic.
They may contain hallucinated commands, incorrect configuration, or unsafe instructions.
In the Fabric-SDK, LLM outputs can influence routing decisions, memory indexing, and
ultimately cluster operations.

- **AI model type:** Ollama (qwen2.5-coder:3b, local), Claude (external escalation)
- **Security concerns:** Hallucinated kubectl commands, incorrect config, unsafe advice
- **Compliance:** OWASP LLM #5 (improper output handling), #9 (misinformation)

## Decision

### Output Validation Rules

1. **Confidence scoring is mandatory** — Every `aiana_query` response includes a
   confidence score. The gateway will not route to a fabric returning 0 confidence.

2. **Three-lane routing as validation** — The confidence threshold system IS the
   output validation layer. Low confidence answers are never presented as certain.

3. **Read-only by default** — fabric-k8s has GET/LIST/WATCH only. Even if an LLM
   hallucinates a write command, the fabric cannot execute it.

4. **AIANA feedback guards** — Only indexes results from non-Claude lanes. Claude
   answers are not indexed as fabric knowledge (prevents circular hallucination).

5. **Context truncation** — All indexed content truncated at 4000 chars. Prevents
   context window bloat from hallucinated verbose output.

6. **Library file cap** — Reference docs capped at 6 files / 8000 chars each per query.

### What We Do NOT Do

- We do not use an LLM to validate another LLM's output (circular dependency)
- We do not present local-llm lane results as deterministic
- We do not execute write operations from LLM suggestions without human approval

## Security Controls

- **Confidence-gated routing** — Answers below threshold never served as authoritative
- **Read-only ClusterRoles** — LLM output cannot trigger destructive k8s operations
- **Human-in-the-loop for writes** — Any future write capability requires its own ADR
- **Source attribution** — Every response includes `source` (cluster/library) and `target_fabric`

## Compliance Mapping

| Framework | Control |
|-----------|---------|
| OWASP LLM Top 10 #5 | Improper output handling — confidence scoring, read-only defaults |
| OWASP LLM Top 10 #9 | Misinformation — three-lane routing, never present uncertain as certain |
| NIST AI RMF — Measure | Confidence scoring quantifies output reliability |
| ISO 42001 — Transparency | Source and confidence always disclosed |

## Consequences

**Positive:**
- Hallucinated output cannot cause destructive actions (read-only)
- Confidence scoring prevents false certainty
- No circular LLM validation dependency

**Negative:**
- Read-only constraint limits automation potential
- Confidence thresholds require tuning per domain
- No semantic validation of output correctness (only confidence-based)

## References

- ADR-001 §7: Local inference layer
- ADR-003 §3.3: Intent validation
