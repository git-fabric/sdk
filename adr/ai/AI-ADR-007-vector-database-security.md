# AI-ADR-007: Vector Database Security Controls

**Status:** Accepted
**Date:** 2026-03-07
**Author:** Ryan / ry-ops.dev

## Context

AIANA uses Qdrant as the vector database for semantic memory. Embeddings represent
resolved queries, cross-fabric context, and user corrections. A compromised or
poisoned vector database could return incorrect context, leading to hallucinated
or misleading responses from the routing system.

- **Vector DB:** Qdrant (in-cluster at `qdrant.cortex-system:6333`)
- **Embedding model:** OpenAI `text-embedding-3-small` (1536 dimensions)
- **Collections:** `aiana_fabric__memories__v1` (organic memories only)
- **Security concerns:** Data poisoning, unauthorized access, stale/incorrect embeddings
- **Compliance:** OWASP LLM #4 (data poisoning), #8 (vector/embedding weaknesses)

## Decision

### Librarian Model — Minimal Embedding Surface

Reference documentation is NOT embedded into Qdrant. Each fabric fetches docs from
git on demand (librarian model). Only organic memories — resolved query results from
the AIANA feedback loop — are embedded. This minimizes the attack surface:
- No bulk corpus to poison
- No stale reference docs accumulating
- Embedding cost scales with unique queries, not corpus size

### What Goes in Qdrant (Organic Memory)

- Resolved query results from the AIANA feedback loop
- Cross-fabric context synthesized at query time
- User corrections and preferences

### What Does NOT Go in Qdrant

- Upstream documentation (k3s-io/docs, Proxmox API, etc.)
- Source code from external repos
- Claude-generated answers (prevents circular dependency)
- Raw user queries (only resolved results with context)

### Memory Isolation

- Each fabric's organic memory is project-scoped in Qdrant
- AIANA doesn't index into itself (`target_fabric !== 'fabric-aiana'`)
- Content truncated at 4000 chars before indexing

## Security Controls

- **Append-only memory** — `aiana_memory_add` creates new entries, never overwrites
- **Project-scoped collections** — fabrics cannot access each other's memories directly
- **No Claude answers indexed** — prevents circular hallucination amplification
- **Truncation at 4000 chars** — prevents context window bloat
- **Fire-and-forget indexing** — indexing failure never blocks the response path
- **In-cluster access only** — Qdrant not exposed outside the k3s mesh

## Compliance Mapping

| Framework | Control |
|-----------|---------|
| OWASP LLM Top 10 #4 | Data and model poisoning — minimal embedding surface, append-only |
| OWASP LLM Top 10 #8 | Vector and embedding weaknesses — project-scoped, no bulk pre-embedding |
| NIST AI RMF — Map | Vector DB risks identified and mitigated |
| ISO 42001 — Data Management | Responsible data usage — only organic memories stored |

## Consequences

**Positive:**
- Minimal attack surface — only organic memories, not entire doc corpuses
- No stale embedding accumulation
- Embedding cost ~$0.02/1M tokens (only feedback loop entries)

**Negative:**
- First-query latency for reference docs (must fetch from git)
- No semantic search over reference docs (keyword matching instead)
- Qdrant dependency for organic memory recall

## References

- ADR-003 §2: Knowledge model (librarian, not warehouse)
- ADR-003 §3.1: Immutable versioning (append-only memory)
- AIANA implementation: `packages/fabric-aiana/src/index.ts`
