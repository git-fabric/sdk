ARCHITECTURE DECISION RECORD
ADR-001
Fabric-SDK
A composable framework for autonomous fabric agents
Author: Ryan / ry-ops.dev
Status: DRAFT
Date: March 2026
Organization: github.com/ry-ops

ADR Number	ADR-001
Title	Fabric-SDK: Composable Framework for Autonomous Fabric Agents
Status	DRAFT — March 2026
Deciders	Ryan (ry-ops.dev)
Supersedes	None — inaugural framework ADR
Related	git-steer, AIANA, Cortex, FABRIC/SOCIAL, gitops-alert-resolver
 
1. Context

Over the past 18 months, a series of infrastructure automation projects — Cortex, git-steer, AIANA, FABRIC/SOCIAL, and gitops-alert-resolver — independently converged on the same architectural pattern: a self-contained service with its own memory, tooling, and escalation path. Each was built domain-first, solving real operational problems before any framework was identified.
The Fabric-SDK is the extraction of that pattern into a reusable framework. It is not a greenfield design — it is the documentation of what was already proven to work, made deliberately repeatable.
The critical prior failure mode was Cortex's use of Kubernetes Jobs as worker primitives. Jobs are designed for fire-and-forget batch work. They cannot maintain state across steps, have unacceptable scheduling latency for reactive workloads, and require complex external coordination for multi-step tasks. git-steer resolved this by using GitHub as the external supervisor — PRs as stateful work units, Actions runners as the execution engine, webhooks as the event bus. This is the worker model the Fabric-SDK formalizes.
Key constraints driving this design:
•	No GPU — local inference must run on CPU (Ollama, quantized 3B-7B models)
•	Self-hosted-first — Tailscale mesh as the zero-trust transport layer
•	Claude as a metered resource — escalation only when no fabric can answer
•	Heterogeneous workloads — repo governance, content distribution, alert remediation, workflow execution
•	Each fabric must be independently deployable without gateway dependency

2. Decision

We adopt the Fabric-SDK as the standard framework for all ry-ops autonomous agent services. Every fabric built on this SDK receives the following capabilities by default:
Standard fabric stack:
◦	MCP Server Domain tool interface and external contract
◦	AIANA + Qdrant Semantic memory, retrieval, and session continuity
◦	Ollama (local LLM) CPU-based local inference for deterministic-but-ambiguous tasks
◦	Redis Route cache, task bus, and session state
◦	Worker agents Domain-specific executors using external supervisors
◦	Claude escalation Last-resort routing when no fabric or local model can resolve
Each fabric is an Autonomous System (AS) in the BGP-style routing model:
•	Advertises its knowledge domain to the gateway on registration
•	Answers queries authoritatively from its own Qdrant collection
•	Forwards to peer fabrics via unicast DNS resolution when needed
•	Escalates to Claude (default route, lowest preference) only as a last resort
•	Withdraws routes when its worker pool is unhealthy

3. OSI Layer Mapping

The Fabric-SDK maps its components to the OSI model as a design framework, not a literal network implementation. This mapping enforces separation of concerns and defines clear enforcement points for each layer.

Layer	OSI Name	Fabric-SDK Component	Responsibility
L7	Application	Worker Agents	Execute domain tasks. Never touch below L6. Supervised by external systems.
L6	Presentation	MCP Protocol	Serialization, schema, tool contracts. The interface boundary for all fabrics.
L5	Session	AIANA	Conversation state, memory continuity, cross-fabric session persistence.
L4	Transport	Interceptor + DNS	Path selection, unicast resolution, routing decisions. Knows topology from L3.
L3	Network	Gateway	BGP-style route reflector. Fabric registry, RIB, Redis route cache.
L2	Data Link	Firewall	Policy enforcement, prompt injection detection, PII scrubbing, auth, audit log.
L1	Physical	Tailscale	Zero-trust transport, mTLS, k3s mesh. No fabric is directly internet-exposed.
Enforcement rule: A worker agent that communicates below its fabric's MCP interface (L6) is an architecture violation. The fabric is the worker's only peer.

4. BGP-Style Routing Model

The gateway implements a BGP-inspired routing model. Each fabric is an Autonomous System that advertises knowledge prefixes. The gateway maintains a Fabric Routing Information Base (F-RIB) and performs unicast path selection. Claude is the default route — 0.0.0.0/0 with the lowest local preference.
4.1 Routing Analogy
BGP Concept	Fabric-SDK Equivalent
Autonomous System (AS)	Individual fabric (git-steer, FABRIC/SOCIAL, n8n, etc.)
Route advertisement	Fabric registers knowledge domain prefixes on startup
Local preference	Qdrant confidence score from AIANA retrieval
MED (tiebreaker)	Embedding freshness — newer context wins
Route withdrawal	Fabric deregisters when worker pool is unhealthy
iBGP	Fabric-to-fabric via gateway (trusted, Tailscale mesh)
eBGP	Claude API (external, different trust level, firewall enforced)
Default route 0.0.0.0/0	Claude — lowest preference, last resort only
Route aggregation	Gateway combines partial knowledge from multiple fabrics
Route cache	Redis — resolved paths cached, same query never broadcasts twice
4.2 Request Lifecycle
Every request follows this path through the stack:
1. Request arrives → L2 Firewall (policy check, PII scrub, auth)
2. → L4 Interceptor (embed prompt, score against AIANA)
3.   High confidence hit → route to fabric's local Ollama
4.   Low confidence → L4 DNS unicast resolution
5.     Gateway consults F-RIB → identify authoritative fabric
6.     Unicast query to peer fabric → returns context + confidence
7.     Aggregate context from all contributing fabrics
8.   No fabric resolves → default route → Claude
9.     Claude receives full aggregated context (never starts cold)
10. Resolution flows back down → worker executes
11. AIANA indexes outcome → F-RIB updated if new pattern learned

5. Fabric Registry

Known fabrics and their BGP-equivalent AS registrations as of March 2026:

Fabric	AS	Knowledge Domain Advertised	Worker Supervisor
git-steer	AS65001	CVE remediation, GitHub lifecycle, repo governance, PR patterns	GitHub Actions + PRs
FABRIC/SOCIAL	AS65002	Content atomization, LinkedIn, newsletter, RAG pipelines	Scheduled records + n8n
gitops-alert-resolver	AS65003	Cluster alerts, Longhorn, ArgoCD, k3s remediation	GitHub Actions + PRs
n8n-fabric	AS65004	Workflow execution, playbooks, event-driven automation	n8n workflow engine
AIANA	AS65005	Semantic memory, embedding patterns, cross-fabric context	Internal (no workers)
Claude (external)	AS65000	0.0.0.0/0 — default route, all unknown patterns	eBGP / external API

6. Worker Agent Model

The canonical worker model is derived from git-steer's GitHub Actions pattern. The core insight: workers should not own their lifecycle. An external system that is already good at supervision — GitHub Actions, n8n, a workflow engine — manages execution, retry, and state persistence.
6.1 Worker Classification
Reactive workers — Event-driven, idle until triggered. Webhook fires, alert arrives, CVE published. Fast startup mandatory.
Proactive workers — Scheduled or polling. Dependency scanner, content scheduler, compliance checker. Latency tolerant.
Stateful workers — Long-running, multi-step, context-preserving. Alert diagnosis + PR creation + validation is a single stateful workflow.
6.2 Worker Contract
Every worker in the Fabric-SDK must conform to this contract:
•	Communicates only with its parent fabric via MCP (L6). Never directly with gateway, peer fabrics, or Claude.
•	Uses an external system as its lifecycle supervisor — never a k3s Job or internal process manager.
•	Produces a durable work unit (PR, record, workflow run) that survives process death.
•	Reports health state to the fabric on a keepalive interval.
•	The fabric withdraws gateway routes if worker pool health drops below threshold.
6.3 Anti-Patterns
The following patterns are explicitly prohibited based on Cortex's k3s Job failure mode:
•	k3s Jobs as worker primitives — scheduling latency, no state persistence, no parent-child communication
•	Workers communicating directly with the gateway or peer fabrics
•	Workers calling Claude directly — all escalation is gateway-mediated
•	Shared mutable state between workers of the same fabric

7. Local Inference Layer

Each fabric runs its own Ollama instance as the local LLM. No GPU is available — all inference runs on CPU with quantized models in the 2-4GB range (qwen2.5-coder:3b, phi4-mini). This is appropriate because the local LLM only handles the middle routing lane: tasks that are ambiguous but bounded.
Three-lane routing:
1.	Deterministic lane — Known pattern, known resolution. No LLM required. Pure tool orchestration via git-steer. Example: CVE dependency bump.
2.	Ambiguous-but-bounded lane — Pattern partially matched, context retrieved. Local Ollama synthesizes response using AIANA context. Async only.
3.	Novel/complex lane — No pattern match, low confidence across all fabrics. Routes to Claude with all retrieved context pre-injected. Claude never starts cold.
Workers do not call Ollama directly. They ask the fabric. The fabric decides which lane applies and handles inference routing internally.

8. Firewall Layer

The firewall sits at L2 — it enforces policy before any fabric topology is involved. It is the boundary between the Tailscale mesh (trusted) and anything external, including Claude (eBGP).
Firewall responsibilities:
•	Prompt injection detection — sanitize inputs before they reach fabric routing
•	PII scrubbing — strip sensitive data before any escalation to Claude
•	Authentication and authorization — verify request origin against Tailscale identity
•	Rate limiting — protect local inference from runaway worker loops
•	Audit logging — every request logged with routing decision for post-hoc analysis
•	Content policy enforcement — block request classes that should never leave the mesh
Deployment options:
•	Cloudflare AI Gateway at the perimeter (leverages existing Cloudflare relationship, handles external traffic)
•	Self-hosted policy engine within the Tailscale mesh (full control, no external dependency)
•	Hybrid: Cloudflare at internet boundary, internal policy engine for mesh-internal enforcement

9. Consequences

9.1 Positive
•	Every new fabric starts 80% complete — stack is pre-wired, developer implements domain tools only
•	Claude API costs reduced structurally — deterministic tasks never escalate
•	Fabric independence — each fabric deployable and testable without gateway
•	Routing decisions are deterministic and auditable — F-RIB explains every path
•	Worker lifecycle is solved — external supervisors handle what k3s Jobs could not
•	Knowledge accumulates — AIANA indexes every resolution, improving local hit rate over time
9.2 Negative / Trade-offs
•	Per-fabric Ollama instance increases resource footprint on CPU-only homelab
•	Gateway registration protocol must be defined before second fabric can benefit from DNS routing
•	Confidence threshold tuning required per fabric — wrong threshold either wastes Claude credits or gives poor local answers
•	External supervisor dependency (GitHub) introduces a single point of failure for git-steer and gitops-alert-resolver worker lanes
9.3 Risks
•	BGP analogy may break down at edge cases — routing loops, split-brain between fabric instances
•	Local model quality on CPU may be insufficient for L4 ambiguous-but-bounded lane without GPU
•	Route cache staleness — Redis cache must have appropriate TTL to prevent serving outdated resolutions

10. Implementation Sequence

The Fabric-SDK is built iteratively. Each phase delivers working software, not just documentation.
Phase 1 — Spec (now)
◦	This ADR Defines the framework, contracts, and layer responsibilities
◦	Worker contract Formal spec for what a compliant worker must implement
◦	Fabric registration protocol How a fabric advertises routes to the gateway
Phase 2 — Scaffold
◦	fabric-sdk init Template repo bootstrapping full stack for a new fabric
◦	Gateway skeleton F-RIB, registration endpoint, Redis cache, health monitoring
◦	Firewall module Prompt injection, PII scrub, audit log
Phase 3 — Retrofit
◦	git-steer Register with gateway, add Ollama local inference, define knowledge prefixes
◦	gitops-alert-resolver First net-new fabric built fully on SDK scaffold
◦	FABRIC/SOCIAL Retrofit content atomization pipeline to SDK worker model
Phase 4 — Operate
◦	Metrics Claude escalation rate, local hit rate, routing latency per fabric
◦	Threshold tuning Adjust confidence thresholds based on real routing data
◦	AIANA feedback loop Resolved Claude answers indexed back into fabric knowledge base


Fabric-SDK  |  ADR-001  |  ry-ops.dev  |  github.com/ry-ops  |  March 2026
This document is a living artifact. Update as the framework evolves.
