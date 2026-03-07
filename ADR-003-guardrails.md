# ADR-003: Development Guardrails & Safety Model

## Status: Accepted
## Date: 2026-03-07

## Context

The Fabric-SDK has moved from spec → scaffold → live deployment with real cluster
access. Six industry patterns inform how we should govern development and runtime
behavior going forward:

1. **Spec-Driven Development** — specs are the primary artifact, not code
2. **Librarian RAG** — fetch on demand, don't pre-embed everything
3. **Agentic Storage Safety** — immutable versioning, sandboxing, intent validation
4. **Secure Agent Architecture** — DevSecOps lifecycle, nonhuman identity, least privilege
5. **Privilege Escalation Prevention** — domain-scoped agency, independent policy enforcement
6. **Prompt Caching Awareness** — static-first prompt structure, cost-conscious design

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

## 5. Secure Agent Architecture (DevSecOps)

### Problem
Fabrics are autonomous agents — they perceive context (queries), reason over goals
(routing, library lookup), and take actions (k8s API calls, git clones, MCP tool calls).
They operate without human intervention. This is not a chatbot. The paradigm shift from
deterministic logic to probabilistic systems means we cannot rely on "same input, same
output." We must shift from code-first to evaluation-first.

### Guardrails

#### 5.1 Agent Development Lifecycle
Every fabric follows: **Plan → Code → Test → Debug → Deploy → Monitor → Plan**

This is not optional. The monitoring phase feeds back into planning. If a fabric's
confidence scores drift, if its library hits decline, if its keepalive pattern changes —
that's a signal to re-plan, not to patch in production.

#### 5.2 DevSecOps — Security Throughout
Security is not bolted on after deployment. It is present at every stage:
- **Plan**: spec defines what the fabric can and cannot do (acceptable agency)
- **Code**: read-only defaults, no hardcoded secrets, prefix-validated routes
- **Test**: validate that the fabric cannot exceed its spec'd permissions
- **Deploy**: Helm charts, immutable image tags, Kubernetes RBAC
- **Monitor**: audit trail on every intercept, route change, and tool call

#### 5.3 Nonhuman Identity
Each fabric is a nonhuman identity with:
- **Unique credentials** — session tokens from gateway registration, not shared
- **Unique AS number** — fabric-k8s is AS65002, fabric-aiana is AS65005
- **Auditable actions** — every intercept, registration, and keepalive is logged
  with fabric_id, timestamp, and audit_id
- Fabrics do NOT share credentials. If fabric-k8s's session expires, fabric-aiana
  is unaffected. If one fabric is compromised, its blast radius is its own domain.

#### 5.4 Human in the Loop
- Claude lane is the human-in-the-loop escalation path. When no fabric is confident,
  the query goes to Claude — the expert, not the automation.
- Write operations (if ever added) MUST require human approval or an explicit ADR.
- New fabric deployments require human review of the spec before implementation begins.

---

## 6. Privilege Escalation Prevention

### Problem
An AI agent with access to a k8s cluster, Proxmox hypervisor, or DNS provider could
escalate its own privileges if not constrained. A malicious prompt could trick a fabric
into accessing tools beyond its domain. A misconfigured ClusterRole could expose the
entire cluster. Privilege inheritance — where a user inherits an agent's elevated
permissions — is the most dangerous pattern.

### Guardrails

#### 6.1 Least Privilege (Non-Negotiable)
- Each fabric gets ONLY the permissions it needs for its read-only domain.
- fabric-k8s: GET/LIST/WATCH on pods, deployments, services, nodes, events, etc.
  No create, update, delete, exec. Ever. Unless a new ADR is written.
- fabric-proxmox (future): read-only VM/node/storage status. No start/stop/migrate.
- The union of user privilege and agent privilege is always the LESSER of the two.

#### 6.2 Independent Policy Decision Point
- The gateway firewall is the independent policy decision point for routing.
  Fabrics cannot self-define what prefixes they advertise — the firewall validates
  that all prefixes start with `fabric.*` and match the fabric's domain.
- A fabric cannot escalate its own routing priority. The F-RIB enforces local_pref
  based on health, not on the fabric's self-reported importance.
- Tool access validation: the `aiana_query` handler in each fabric validates the
  query against its own topic index. It does not blindly execute arbitrary tool calls.

#### 6.3 Dynamic, Context-Based, Short-Lived Access
- Gateway session tokens have TTL (300s default). If a fabric stops sending
  keepalives, its routes degrade and eventually withdraw.
- DNS cache entries expire (configurable TTL). Stale answers are not served
  indefinitely.
- Library git checkouts are ephemeral — cached in `/tmp/fabric-library`, not
  persisted across pod restarts.

#### 6.4 Prompt Injection Defense
- The gateway firewall examines route prefixes, not query content — it cannot be
  prompt-injected because it operates on structured data, not natural language.
- The `aiana_query` handler uses keyword matching and regex, not LLM interpretation,
  to decide which tool to call. A prompt injection cannot trick it into calling a
  tool outside its topic index.
- Ollama (local LLM) operates on pre-fetched library content, not on user-supplied
  prompts directly. The fabric controls what context Ollama sees.

#### 6.5 Monitor and Revoke
- Gateway logs every intercept decision with confidence, lane, and target.
- F-RIB logs every registration, withdrawal, degradation, and restoration.
- If a fabric exhibits abnormal behavior (registering unexpected prefixes, returning
  inconsistent confidence scores), the gateway can withdraw its routes.
- Future: anomaly detection on audit logs to flag privilege escalation attempts.

---

## 7. Cost-Conscious Design (Prompt Caching Awareness)

### Problem
Every LLM call (Claude, OpenAI embeddings, Ollama) has cost — either monetary or
compute. The fabric-SDK is designed to minimize these costs, but careless prompt
construction or unnecessary embedding calls can erode the savings.

### Guardrails

#### 7.1 Minimize LLM Calls
- **Three-lane routing exists to avoid Claude calls.** If a fabric can answer at
  >=0.95 confidence, Claude is never called. If Ollama can synthesize at >=floor,
  Claude is never called. Claude is the last resort, not the first.
- **DNS caching** — resolved queries are cached in Redis with TTL. The same question
  asked twice in 5 minutes does not hit the fabric twice.
- **AIANA feedback loop** — organic memories from previous resolutions can answer
  future queries without hitting the source fabric at all.

#### 7.2 Minimize Embedding Calls
- **Librarian model eliminates bulk embedding.** Reference docs are fetched from
  git and matched by keyword topic index — zero embedding calls.
- **Embeddings only for organic memory.** Only feedback loop entries (resolved
  queries) generate embedding calls. These are small, high-signal, and infrequent.
- **OpenAI text-embedding-3-small** — the cheapest embedding model that meets
  quality requirements. ~$0.02/1M tokens.

#### 7.3 Prompt Structure for Efficiency
When Ollama synthesis is added:
- **Static content first** — system instructions, library context, then user query.
  This enables prompt caching at the Ollama level.
- **Truncation at 4000 chars** — the AIANA feedback loop truncates large contexts
  before indexing. This prevents context window bloat in future recall.
- **Library file cap at 6 files / 8000 chars each** — prevents runaway context
  from large doc sets.

---

## 8. Anti-Patterns (Things We Don't Do)

| Anti-Pattern | Why Not | What Instead |
|---|---|---|
| Pre-embed entire doc corpuses | Storage bloat, stale data, embedding cost | Librarian model: fetch on demand |
| Shared Qdrant collections across fabrics | Knowledge knot, domain confusion | Each fabric's organic memory is project-scoped |
| Central Ollama brain | Single point of failure, domain confusion | Per-fabric reasoning over own domain |
| Claude answers indexed as fabric knowledge | Circular dependency, Claude isn't authoritative | Only index fabric-sourced resolutions |
| Write access in default ClusterRoles | Blast radius of hallucination | Read-only by default, write needs ADR |
| Vibe-coding new fabrics | Inconsistent behavior, no spec to validate against | Spec → design → implement → test |
| Git clone of large repos on demand | Timeout, disk, network | GitHub raw API for source code |
| Shared credentials across fabrics | Compromise one = compromise all | Unique session tokens per fabric |
| Self-defined permissions | Privilege escalation vector | Independent policy decision point (firewall) |
| LLM-interpreted routing decisions | Prompt injection risk | Structured data matching (regex, keywords) |
| Persistent elevated access | Attack amplification | Short-lived tokens, TTL-based sessions |
| Dynamic content first in prompts | Cache miss on every call, wasted compute | Static content first, dynamic last |
| Embedding calls for reference docs | Cost scales with corpus size | Topic index + git fetch = zero embedding cost |

---

## 9. Change Order Process

### Problem
Direct pushes to main, untested deployments, and undocumented changes undermine every
guardrail above. During enforcement testing (2026-03-07), six issues were discovered —
several caused by skipping process (overwriting image tags, pushing directly to main).

### Rules

1. **Document first** — every change gets an issue ID and entry in the change log
   before code is written. Problem, fix, affected files.
2. **Branch and PR** — all code changes go through a branch (`fix/<id>` or `feat/<id>`)
   and a pull request. No direct pushes to main.
3. **Human approves** — PRs require human review before merge. The human can approve
   via GitHub UI or by explicit instruction.
4. **Build correctly** — always `--platform linux/amd64` for k3s cluster. Never overwrite
   image tags. New changes get new tags.
5. **Test before deploy** — run the enforcement test suite and verify all checks pass
   before declaring a change complete.
6. **Deploy via Helm** — `helm upgrade` with explicit `--set image.tag=<new>`. No
   `kubectl apply` without a chart. No `kubectl set image` shortcuts.

### Enforcement Test Results (2026-03-07, gateway 0.1.7)

26/26 checks passing:

| Category | Tests | Result |
|---|---|---|
| Gateway health & registration | 3 | PASS |
| F-RIB state (sessions + routes) | 4 | PASS |
| Prefix binding (cross-domain, blocked, namespace escape) | 5 | PASS |
| Firewall (injection, PII scrubbing) | 2 | PASS |
| Routing lanes (deterministic, local-llm, claude) | 5 | PASS |
| AIANA feedback loop | 1 | PASS |
| Metrics endpoint | 3 | PASS |
| Persistent audit log | 3 | PASS |

Metrics snapshot: **84.9% Claude avoidance rate**, 53 intercepts (19 deterministic,
26 local-llm, 8 claude), 13.6% DNS cache hit ratio, 148 audit entries.

### Issues Discovered During Testing

| ID | Status | Description |
|---|---|---|
| DNS-001 | OPEN | Route TTL expires but session survives — routes disappear silently |
| DNS-002 | OPEN | Stale DNS cache survives gateway restart — wrong routing lane |
| BUILD-001 | OPEN | No build script — easy to forget `--platform linux/amd64` |
| FW-001 | FIXED | Prefix binding derived domain from fabric_id — too strict |
| FW-002 | FIXED | Injection regex missed "ignore all previous instructions" |
| BUILD-002 | FIXED | Image tag overwritten — node cached stale image |

---

## Decision

All fabric development and deployment follows these guardrails effective immediately.
New fabrics (proxmox, tailscale, cloudflare, etc.) must be specced before implementation.
The librarian model is the standard for reference knowledge. Agentic storage safety
principles (immutable versioning, sandboxing, intent validation) are non-negotiable.

The secure agent architecture principles (DevSecOps lifecycle, nonhuman identity,
human-in-the-loop escalation) apply to every fabric. Privilege escalation prevention
(least privilege, independent policy enforcement, prompt injection defense) is
foundational — not aspirational.

Cost-conscious design is a first-class concern: minimize Claude calls via three-lane
routing, minimize embedding calls via the librarian model, structure prompts for
caching efficiency.

The change order process (§9) is mandatory for all code changes. No direct pushes,
no undocumented changes, no deploying without a PR and human approval.
