# AI-ADR-006: AI Agent Permission Boundaries

**Status:** Accepted
**Date:** 2026-03-07
**Author:** Ryan / ry-ops.dev

## Context

Fabrics are autonomous agents with real access — fabric-k8s reads the live cluster,
fabric-proxmox manages VMs, fabric-cloudflare controls DNS. An agent with broad
permissions that hallucinates or misinterprets could cause real damage. Privilege
escalation — where an agent expands its own permissions — is the most dangerous pattern.

- **AI model type:** Autonomous agents with MCP tool access, local LLM reasoning
- **Security concerns:** Privilege escalation, cross-domain access, blast radius of hallucination
- **Compliance:** OWASP LLM #6 (excessive agency), NIST AI RMF

## Decision

### Least Privilege (Non-Negotiable)

Each fabric gets ONLY the permissions it needs for its read-only domain:
- **fabric-k8s:** GET/LIST/WATCH on pods, deployments, services, nodes, events.
  No create, update, delete, exec. Ever. Unless a new ADR is written.
- **fabric-proxmox (future):** Read-only VM/node/storage status. No start/stop/migrate.
- Write access for ANY fabric requires its own ADR and its own ClusterRole.

### Domain Isolation

- Each fabric owns its prefix namespace (`fabric.k8s.*`, `fabric.memory.*`)
- Firewall validates all prefixes share one `fabric.{domain}` root per registration
- Cross-domain queries resolve through the gateway, not through shared state
- Ollama is per-fabric — local LLM reasons over its own domain only

### Nonhuman Identity

Each fabric is a nonhuman identity with:
- Unique session tokens (not shared between fabrics)
- Unique AS numbers (fabric-k8s=AS65002, fabric-aiana=AS65005)
- Auditable actions (every intercept, registration, keepalive logged)
- Independent blast radius (if one fabric is compromised, others are unaffected)

### Independent Policy Decision Point

- The gateway firewall is the independent policy decision point
- Fabrics cannot self-define what prefixes they advertise
- A fabric cannot escalate its own routing priority
- Tool access validation uses keyword matching, not LLM interpretation

## Security Controls

- **Read-only ClusterRoles** — no write access without dedicated ADR
- **Prefix binding enforcement** — cross-domain registration rejected at firewall
- **Session token isolation** — per-fabric, TTL-based, expires on missed keepalives
- **Short-lived access** — 300s route TTL, 30s keepalive interval
- **Human-in-the-loop** — Claude lane is the escalation path for uncertain decisions

## Compliance Mapping

| Framework | Control |
|-----------|---------|
| OWASP LLM Top 10 #6 | Excessive agency — least privilege, read-only defaults |
| NIST AI RMF — Govern | Permission boundaries defined in ADR, enforced by firewall |
| NIST AI RMF — Manage | Session TTL and keepalive prevent persistent elevated access |
| ISO 42001 — Risk Management | Blast radius contained per fabric |

## Consequences

**Positive:**
- Hallucination cannot cause destructive cluster operations
- Compromised fabric cannot affect other domains
- Permission expansion requires explicit ADR — never implicit

**Negative:**
- Read-only limits automation potential (deliberate trade-off)
- New write capabilities require full ADR lifecycle
- Per-fabric session management adds operational complexity

## References

- ADR-003 §3.2: Sandboxing (domain isolation)
- ADR-003 §6: Privilege escalation prevention
- Gateway firewall: `packages/gateway/src/firewall/index.ts`
