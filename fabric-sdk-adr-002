ARCHITECTURE DECISION RECORD
ADR-002
Fabric-SDK
Worker Contract  &  Fabric Registration Protocol

ADR Number	ADR-002
Status	DRAFT — March 2026
Depends On	ADR-001 (Fabric-SDK Architecture)
Author	Ryan / ry-ops.dev
Repo	github.com/ry-ops/fabric-sdk

 
PART 1
Worker Contract

The Worker Contract defines the minimum interface every worker agent must implement to be compliant with the Fabric-SDK. It enforces the separation of concerns established in ADR-001: workers execute domain tasks, fabrics handle routing and inference, the gateway handles topology.
This contract is binding. A worker that violates it is not a Fabric-SDK worker — it is an unmanaged process.

1. Worker Identity

Every worker must declare a stable identity at startup. This identity is used by the fabric for health tracking, route management, and AIANA indexing of outcomes.

Field	Specification
worker_id	Globally unique within the fabric. Format: {fabric}.{domain}.{instance}  e.g. git-steer.cve-scanner.01
fabric_id	The parent fabric this worker belongs to. Must match a registered fabric AS.
worker_type	One of: reactive | proactive | stateful
version	Semantic version string. Used by fabric to detect stale workers after deployments.
capabilities	Array of task types this worker can execute. Used by fabric for dispatch decisions.
supervisor	The external system managing this worker's lifecycle. e.g. github-actions | n8n | cron

2. Worker Classification

2.1 Reactive
Event-driven. Idle until a trigger arrives. Must be capable of cold-start within 2 seconds of trigger receipt. Lifecycle is managed by webhooks or event bus.
•	Example: cve-scanner wakes on GitHub Advisory webhook
•	Supervisor: GitHub Actions (workflow_dispatch or repository_dispatch)
•	State: Stateless between triggers. State lives in the work unit (PR/issue).
2.2 Proactive
Scheduled or polling. Acceptable startup latency. Must declare its schedule to the fabric on registration so the fabric can track expected execution windows.
•	Example: dependency-bumper runs nightly dependency audit
•	Supervisor: GitHub Actions (schedule trigger) or n8n cron workflow
•	State: Stateless. Results written to work unit. AIANA indexed by fabric after completion.
2.3 Stateful
Long-running, multi-step. Maintains context across steps within a single work unit. The work unit itself is the state store — it must be durable and recoverable after process interruption.
•	Example: alert-classifier → remediation-agent → pr-validator pipeline in gitops-alert-resolver
•	Supervisor: GitHub Actions (multi-job workflow with artifact passing between jobs)
•	State: PR description + labels + comments as the state machine. Resumable from last known step.

3. Communication Rules

This is the most critical section of the Worker Contract. Communication topology violations are the primary source of architectural drift.

◆ RULE:  A worker communicates ONLY with its parent fabric via the fabric's MCP interface (L6). Never with the gateway, peer fabrics, Claude, or any other worker directly.

Communication Target	Allowed?	Correct Alternative
Parent fabric MCP interface	YES	— this is the only channel
Gateway directly	NO	Parent fabric routes upward if needed
Peer fabric MCP directly	NO	Parent fabric queries gateway DNS
Claude API directly	NO	Parent fabric handles escalation
Other workers in same fabric	NO	Coordinate via shared work unit state
Qdrant / Redis directly	NO	Access via fabric MCP tools only
External APIs (GitHub, etc.)	YES	Workers may call their supervisor system

⚠ VIOLATION:  A worker that calls the Claude API, queries Qdrant directly, or contacts a peer fabric's MCP server is an architecture violation. The fabric must be the sole intermediary for all inference and memory operations.

4. Work Unit Contract

Every worker must produce a durable work unit that persists independently of the worker process. The work unit is the state store, audit trail, and recovery mechanism.

Fabric	Work Unit Primitive	Supervisor System
git-steer	GitHub Pull Request	GitHub Actions
gitops-alert-resolver	GitHub Pull Request	GitHub Actions
FABRIC/SOCIAL	Scheduled content record	n8n workflow run
n8n-fabric	n8n workflow execution	n8n engine
Any new fabric	Domain-appropriate record	External system, never k8s Job

A work unit must satisfy all of the following:
•	Durable: Survives worker process death. The work can be resumed or retried from the unit state alone.
•	Auditable: Contains a full record of what was attempted, what succeeded, and what failed.
•	Atomic: A single work unit represents a single coherent task. Do not bundle unrelated operations.
•	Indexed: On completion, the fabric indexes the outcome into AIANA so future similar tasks can route to the deterministic lane.

5. Health and Keepalive

The fabric tracks worker pool health to decide whether to advertise its knowledge routes to the gateway. A fabric with an unhealthy worker pool withdraws affected route prefixes until health is restored.

•	Keepalive interval: Workers must emit a health signal to the fabric at minimum every 60 seconds during active execution.
•	Health signal payload: worker_id, status (healthy | degraded | failed), current work unit ID if active, last completion timestamp.
•	Unhealthy threshold: Fabric marks a worker unhealthy after 3 missed keepalive intervals.
•	Recovery: Worker resumes healthy status automatically on next successful keepalive. No manual intervention required.
•	Route withdrawal: If >50% of workers for a given capability are unhealthy, the fabric withdraws that capability's route prefix from the gateway.

6. Prohibited Patterns

The following patterns are explicitly prohibited. All derive from the Cortex k3s Job failure mode documented in ADR-001.

Anti-Pattern	Why Prohibited
k8s Job as worker primitive	Scheduling latency, no state persistence, no parent-child communication channel.
Worker owns its own lifecycle	Process supervisor must be external. Workers should not manage their own restart.
Direct Claude API calls from worker	Bypasses firewall (L2), interceptor (L4), and route cache (L3). Creates unaudited cost.
Shared mutable state between workers	Race conditions, non-deterministic outcomes, unauditable state transitions.
Worker spawns child workers	Lifecycle entanglement. Each worker is a leaf node. Orchestration belongs to the fabric.
In-memory-only work unit state	Process death loses all progress. All state must be written to the durable work unit.
Polling as primary event mechanism	The cause of the GitHub account suspension in git-steer history. Use webhooks.

 
PART 2
Fabric Registration Protocol

The Fabric Registration Protocol (FRP) defines how a fabric announces itself to the gateway, advertises its knowledge domain prefixes, and participates in the BGP-style routing model established in ADR-001.
FRP is the fabric equivalent of a BGP session establishment + route advertisement sequence. It is the mechanism by which the gateway builds and maintains the Fabric Routing Information Base (F-RIB).

7. Registration Lifecycle

Step	Phase	Description
1	CONNECT	Fabric establishes authenticated session with gateway over Tailscale mesh.
2	IDENTIFY	Fabric sends identity payload: fabric_id, AS number, MCP endpoint, Ollama endpoint, version.
3	ADVERTISE	Fabric sends route advertisement: knowledge prefixes, confidence baseline, worker pool status.
4	ACKNOWLEDGE	Gateway validates, inserts routes into F-RIB, returns session token + peer list.
5	KEEPALIVE	Fabric sends keepalive every 30 seconds. Gateway marks fabric unreachable after 3 missed.
6	UPDATE	Fabric sends UPDATE when worker pool health changes or new capabilities are added.
7	WITHDRAW	Fabric sends WITHDRAW on graceful shutdown or capability loss. Gateway removes routes.

8. Registration Payload

The following JSON schema defines the registration payload. All fields are required unless marked optional.

// Fabric registration payload — sent at step 2+3 of lifecycle
{
  "fabric_id":    "git-steer",
  "as_number":    65001,
  "version":      "2.4.1",
  "mcp_endpoint": "http://git-steer.fabric.svc:8080/mcp",
  "ollama_endpoint": "http://git-steer.fabric.svc:11434",   // optional
  "ollama_model":    "qwen2.5-coder:3b",                    // optional
  "supervisor":      "github-actions",
  "tailscale_node":  "git-steer",
  "worker_pool": {
    "total": 4,
    "healthy": 4,
    "workers": [
      { "worker_id": "git-steer.cve-scanner.01",       "type": "reactive",   "status": "healthy" },
      { "worker_id": "git-steer.pr-agent.01",          "type": "stateful",   "status": "healthy" },
      { "worker_id": "git-steer.dependency-bumper.01", "type": "proactive",  "status": "healthy" },
      { "worker_id": "git-steer.repo-auditor.01",      "type": "proactive",  "status": "healthy" }
    ]
  },
  "routes": [
    { "prefix": "fabric.cve",    "local_pref": 100, "description": "CVE remediation patterns and advisories" },
    { "prefix": "fabric.github", "local_pref": 100, "description": "GitHub Actions, PR lifecycle, repo governance" },
    { "prefix": "fabric.repo",   "local_pref": 100, "description": "Repository audit, compliance, dependency management" }
  ]
}

9. Route Prefix Specification

Route prefixes define what knowledge domain a fabric owns. They are the equivalent of BGP network prefixes. The gateway uses them to build the F-RIB and perform unicast DNS resolution.

Field	Specification
prefix	Dot-notation namespace. Format: fabric.{domain}[.{subdomain}]  e.g. fabric.cve, fabric.github.actions
local_pref	Integer 1–200. Higher wins on tie. Default 100. Increase for high-confidence specialized fabrics.
description	Human-readable description of what knowledge this prefix covers. Used in gateway F-RIB display.
ttl	Optional. Seconds before route is considered stale. Default 300. Use lower values for fast-changing domains.
confidence_floor	Optional. Minimum AIANA confidence score (0.0–1.0) before this fabric considers itself authoritative. Default 0.7.

Known prefix registry across all current fabrics:

Prefix	Owner Fabric	Description
fabric.cve	git-steer	CVE advisories, remediation patterns, dep bumps
fabric.github	git-steer	GitHub API, Actions, PR/issue lifecycle
fabric.repo	git-steer	Repo governance, auditing, dependency management
fabric.content	FABRIC/SOCIAL	Blog, LinkedIn, newsletter, content atomization
fabric.qdrant	FABRIC/SOCIAL	RAG pipelines, embedding patterns, retrieval
fabric.workflow	n8n-fabric	n8n workflow definitions, playbooks
fabric.webhook	n8n-fabric	Event-driven trigger patterns, webhook handling
fabric.alert	gitops-alert-resolver	Cluster alerts, Prometheus rules, triage patterns
fabric.k8s	gitops-alert-resolver	k3s, ArgoCD, Longhorn remediation patterns
fabric.memory	AIANA	Semantic memory, cross-fabric context, embeddings
0.0.0.0/0 (default)	Claude (external)	All unresolved patterns — escalation of last resort

10. Gateway F-RIB

The Fabric Routing Information Base is the gateway's routing table. It is built from fabric registrations and maintained by keepalives and updates. Redis provides the persistence and cache layer.

// F-RIB entry structure (stored in Redis hash per prefix)
fabric:rib:{prefix} → {
  "fabric_id":       "git-steer",
  "as_number":       65001,
  "mcp_endpoint":    "http://git-steer.fabric.svc:8080/mcp",
  "local_pref":      100,
  "confidence_floor": 0.7,
  "last_seen":       1741234567,
  "worker_health":   "healthy",
  "ttl":             300
}

// F-RIB session tracking (per registered fabric)
fabric:session:{fabric_id} → {
  "session_token":   "tok_abc123",
  "connected_at":    1741234500,
  "last_keepalive":  1741234567,
  "routes_advertised": ["fabric.cve", "fabric.github", "fabric.repo"],
  "status":          "active"   // active | degraded | withdrawn
}

11. Keepalive and Route Withdrawal

Keepalives are the mechanism by which the gateway knows a fabric is still healthy and its routes are still valid. Missed keepalives trigger route withdrawal — the BGP equivalent of a session timeout.

Condition	Gateway Action
Keepalive received	Update last_seen. Route remains active in F-RIB.
1 missed keepalive	Log warning. No action.
2 missed keepalives	Mark fabric status: degraded. Reduce local_pref by 50.
3 missed keepalives	Withdraw all fabric routes from F-RIB. Traffic routes to next-best or Claude default.
WITHDRAW message received	Immediate route removal. Graceful — no penalty on re-registration.
Fabric re-registers after gap	Routes re-inserted at original local_pref. Session token regenerated.
Worker pool health drops <50%	Fabric sends UPDATE with reduced local_pref for affected prefixes.

12. Unicast DNS Resolution Flow

When the interceptor cannot route a request from the local fabric's AIANA cache, it initiates a unicast DNS query via the gateway. This is not a broadcast — the gateway consults the F-RIB and sends the query directly to the most authoritative fabric for the relevant prefix.

// DNS resolution sequence
1. Interceptor: embed(request) → similarity_score against local AIANA
2. Score < confidence_floor → send DNS query to gateway
   { query: request_embedding, domain_hint: 'fabric.cve', requestor: 'git-steer' }
3. Gateway: consult F-RIB → select highest local_pref fabric for prefix
4. Gateway: unicast MCP call to authoritative fabric
   { tool: 'aiana_query', embedding: request_embedding, top_k: 5 }
5. Authoritative fabric: query own Qdrant → return { context, confidence }
6. Gateway: cache result in Redis  key: fabric:dns:{hash(query)}  TTL: 300s
7. Gateway: return context + confidence to requesting interceptor
8. Interceptor: confidence >= threshold → local Ollama synthesizes with context
              confidence <  threshold → escalate to Claude with context injected

◆ RULE:  The gateway caches DNS resolutions in Redis. The same query from any fabric within the TTL window is served from cache without contacting the authoritative fabric again.

13. Conflict Resolution

When two fabrics advertise overlapping prefixes, the gateway applies BGP-equivalent path selection rules in this order:

1.	Longest prefix match  —  fabric.cve.npm beats fabric.cve for an npm CVE query.
2.	Highest local_pref  —  local_pref 120 beats 100 for equal-length prefixes.
3.	Highest confidence_floor  —  fabric with higher minimum confidence threshold wins as more specialized.
4.	Freshest embedding  —  MED equivalent. Fabric with most recently indexed Qdrant data wins.
5.	Aggregate and combine  —  If still tied, gateway aggregates context from both fabrics and passes combined context upstream.

14. Security Constraints

All FRP communication travels over the Tailscale mesh. No fabric registration endpoint is exposed outside the mesh.

•	Authentication: Tailscale node identity is the authentication mechanism. No separate API key required for mesh-internal registration.
•	Authorization: Fabrics may only advertise prefixes in the fabric.* namespace. No fabric may advertise 0.0.0.0/0 (reserved for Claude external route).
•	Prefix hijacking: Gateway rejects registrations that claim a prefix already owned by a healthy fabric with equal or higher local_pref without an explicit supersede flag.
•	Firewall enforcement: All traffic leaving the mesh to Claude (eBGP) passes through the L2 firewall regardless of routing path. No fabric can bypass this.
•	Audit log: Every registration, withdrawal, DNS resolution, and escalation is logged with timestamp, fabric_id, and routing decision.


Fabric-SDK  |  ADR-002  |  ry-ops.dev  |  github.com/ry-ops  |  March 2026
Depends on ADR-001. This document is a living artifact — update as implementation reveals gaps.
