# ADR-003: Development Guardrails & Safety Model

## Status: Accepted
## Date: 2026-03-07

## Context

The Fabric-SDK has moved from spec → scaffold → live deployment with real cluster
access. Three industry patterns inform how we should govern development and runtime
behavior going forward:

1. **Spec-Driven Development** — specs are the primary artifact, not code
2. **Librarian RAG** — fetch on demand, don't pre-embed everything
3. **Agentic Storage Safety** — immutable versioning, sandboxing, intent validation

This ADR establishes guardrails for both the development process and the runtime
behavior of the fabric ecosystem.

---

## 1. Development Process: Spec-Driven, Not Vibe-Coded

### Problem
Vibe coding (prompt → code → iterate) produces inconsistent results and skips the
SDLC. The fabric-SDK is infrastructure — it routes queries across autonomous systems,
accesses real clusters, and makes decisions about what to trust. This is not a place
for ambiguity.

### Guardrail
Every new fabric, capability, or protocol change MUST follow:

```
Spec → Requirements → Design → Implementation → Test → Deploy
```

**Spec first, code last.** The spec is the contract. The LLM implements the contract.
If the implementation doesn't match the spec, the implementation is wrong — not the spec.

### Rules
- **ADRs for architecture decisions** — ADR-001 (architecture), ADR-002 (worker contract),
  ADR-003 (this document). New decisions get new ADRs.
- **No feature without a spec** — before adding a capability to any fabric, document:
  what it does, what it doesn't do, what routes it advertises, what libraries it owns.
- **Specs live in the repo** — not in chat transcripts, not in memory. The repo is
  the source of truth.
- **Tests validate the spec** — not just "does it run" but "does it behave as specified."

---

## 2. Knowledge Model: Librarian, Not Warehouse

### Problem
Pre-embedding entire doc corpuses into Qdrant (the warehouse model) doesn't scale.
451 chunks for k3s docs alone. Multiply by every fabric's domain (proxmox, tailscale,
cloudflare, linux, debian, k8s) and storage/cost becomes unmanageable. Stale data
accumulates. The knowledge graph becomes an unusable knot.

### Guardrail
Each fabric is a librarian for its domain. It knows where the books are. It doesn't
photocopy them.

### Rules

**What goes in Qdrant (organic memory):**
- Resolved query results from the AIANA feedback loop
- Cross-fabric context that was synthesized at query time
- User corrections and preferences

**What does NOT go in Qdrant (reference docs):**
- Upstream documentation (k3s-io/docs, Proxmox API, Cloudflare API)
- Source code from external repos
- Static reference material that has a canonical source

**How reference knowledge works:**
- Each fabric maintains a **source registry** — a map of topic → git repo → file paths
- When a query matches a topic, the fabric **fetches on demand** (git clone or raw API)
- The fetched content is returned as context, then discarded (check out, read, return)
- AIANA remembers the **conversation** (query + resolution), not the book

**RAG approach: Hybrid, not full multimodal**
- Text retrieval via embeddings (Qdrant) for organic memories only
- Structured retrieval via topic index (keyword → file mapping) for reference docs
- No pre-embedding of reference material
- Ollama synthesizes answers from raw library content when confidence < 0.95

---

## 3. Runtime Safety: Agentic Storage Principles

### Problem
Fabrics have real access — fabric-k8s reads the live cluster, fabric-proxmox manages
VMs, fabric-cloudflare controls DNS. An agent with broad permissions that hallucinates
or misinterprets could cause real damage.

### Guardrails

#### 3.1 Immutable Versioning
- **AIANA memories are append-only** — `aiana_memory_add` creates new entries, never
  overwrites. Delete requires explicit ID targeting.
- **F-RIB route changes are audited** — every register, withdraw, degrade, and restore
  is logged with audit_id and timestamp.
- **Gateway audit trail** — every intercept decision is recorded: query hash, lane,
  confidence, target fabric, audit_id.

#### 3.2 Sandboxing (Domain Isolation)
- **Each fabric owns its domain. Period.**
  - `fabric-k8s` → `fabric.k8s.*` — cannot advertise `fabric.proxmox.*`
  - `fabric-proxmox` → `fabric.proxmox.*` — cannot advertise `fabric.k8s.*`
  - The firewall enforces prefix validation: routes must start with `fabric.*`
- **Read-only by default** — fabric-k8s has ClusterRole with GET/LIST/WATCH only.
  No create, update, delete, exec. If write access is ever needed, it gets its own
  ADR and its own ClusterRole.
- **Library isolation** — each fabric only knows its own repos. fabric-k8s doesn't
  index Proxmox docs. fabric-proxmox doesn't index k3s docs. Cross-domain queries
  resolve through the gateway's aggregation path, not through shared state.
- **Ollama is per-fabric** — the local LLM reasons over its own domain only. It never
  needs to understand the full ecosystem. Cross-domain synthesis happens at the gateway
  level via aggregation (ADR-002 §13).

#### 3.3 Intent Validation
- **Confidence scoring is mandatory** — every `aiana_query` response includes a
  confidence score. The gateway will not route to a fabric that returns 0 confidence.
- **Three-lane routing as a safety valve:**
  - Deterministic (>=0.95): fabric is authoritative, answer is trusted
  - Local-LLM (>=floor): fabric has relevant context, Ollama can synthesize
  - Claude (<floor): nobody knows, escalate to the expert
  The system never silently returns a low-confidence answer as if it were certain.
- **AIANA feedback loop has guards:**
  - Only indexes results from non-claude lanes (don't index Claude's answers as
    fabric knowledge — that's circular)
  - Only indexes when target_fabric !== 'fabric-aiana' (AIANA doesn't index into itself)
  - Content is truncated at 4000 chars (prevents context window bloat)
  - Fire-and-forget with error logging (indexing failure never blocks the response)

---

## 4. Deployment Safety

### Rules
- **No force-push to main** on any fabric repo
- **Helm charts are the deployment contract** — no kubectl apply without a chart
- **Image tags are immutable** — once `ghcr.io/git-fabric/k8s:0.3.1` is pushed, that
  tag is never overwritten. New changes get new tags.
- **Secrets are never in code** — always in Kubernetes secrets, referenced by name
- **All work in `/tmp/`** — local clones for building are ephemeral. The repos on
  GitHub are the source of truth.

---

## 5. Anti-Patterns (Things We Don't Do)

| Anti-Pattern | Why Not | What Instead |
|---|---|---|
| Pre-embed entire doc corpuses | Storage bloat, stale data, embedding cost | Librarian model: fetch on demand |
| Shared Qdrant collections across fabrics | Knowledge knot, domain confusion | Each fabric's organic memory is project-scoped |
| Central Ollama brain | Single point of failure, domain confusion | Per-fabric reasoning over own domain |
| Claude answers indexed as fabric knowledge | Circular dependency, Claude isn't authoritative | Only index fabric-sourced resolutions |
| Write access in default ClusterRoles | Blast radius of hallucination | Read-only by default, write needs ADR |
| Vibe-coding new fabrics | Inconsistent behavior, no spec to validate against | Spec → design → implement → test |
| Git clone of large repos on demand | Timeout, disk, network | GitHub raw API for source code |

---

## Decision

All fabric development and deployment follows these guardrails effective immediately.
New fabrics (proxmox, tailscale, cloudflare, etc.) must be specced before implementation.
The librarian model is the standard for reference knowledge. Agentic storage safety
principles (immutable versioning, sandboxing, intent validation) are non-negotiable.
