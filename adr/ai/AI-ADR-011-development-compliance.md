# AI-ADR-011: Development Compliance — Change Requests, PRs, and Deployment Governance

**Status:** Accepted
**Date:** 2026-03-07
**Author:** Ryan / ry-ops.dev

## Context

The Fabric-SDK is infrastructure — it routes queries across autonomous systems,
accesses real clusters, and makes decisions about what to trust. Direct pushes,
undocumented changes, and untested deployments undermine every security guardrail
in this ADR suite.

During enforcement testing (2026-03-07), six issues were discovered — several caused
by skipping process (overwriting image tags, pushing directly to main). This ADR
formalizes the development compliance rules that prevent those failures.

- **Repos:** `git-fabric/{sdk,k8s,gateway,aiana,...}` (12 public, 3 private)
- **Deployment:** Helm charts → k3s cluster, ArgoCD for gitops targets
- **CI/CD:** GitHub Actions, future Ansible for provisioning
- **Security concerns:** Undocumented changes, untested deployments, broken audit trail

## Decision

### Change Request Workflow

Every code change follows this lifecycle:

```
Document → Branch → Implement → Test → PR → Approve → Build → Deploy → Verify
```

**No exceptions.** No direct pushes to main. No "quick fix" bypasses.

#### 1. Document the Change

Before writing code, document in the change log (`fabric-sdk-issues.md` or GitHub Issue):
- **Issue ID** — unique identifier (e.g., DNS-001, FW-002, FEAT-003)
- **Problem** — what's broken or missing
- **Proposed fix** — what will change and which files
- **Affected systems** — gateway, fabric-k8s, AIANA, Helm charts, etc.

#### 2. Create a Branch

- Branch naming: `fix/<issue-id>` or `feat/<issue-id>` or `docs/<description>`
- Branch from `main` — always current
- One logical change per branch (may include multiple files)

#### 3. Implement and Test

- Type-check: `tsc --noEmit` must pass
- Build: `docker buildx build --platform linux/amd64` must succeed
- Test: enforcement test suite must pass (26/26 or more)
- Never overwrite image tags — always increment

#### 4. Open a Pull Request

- PR title: concise, under 70 characters
- PR body: summary, issue IDs referenced, test plan
- Co-authored commits: `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`

#### 5. Human Approval

- PRs require human review before merge
- Human approves via GitHub UI or explicit instruction to Claude
- Claude does NOT merge without approval
- Claude does NOT push directly to main

#### 6. Build and Deploy

- Build with `make build-gateway TAG=x.y.z` or equivalent
- Always `--platform linux/amd64` (k3s cluster is amd64)
- Image tags are immutable — once pushed, never overwritten
- Deploy via Helm: `helm upgrade` with explicit `--set image.tag=<new>`
- No `kubectl apply` without a chart
- No `kubectl set image` shortcuts

#### 7. Verify

- Run enforcement test suite after deploy
- Check gateway logs for errors
- Verify `/health` endpoint shows expected fabric/route counts
- Check `/metrics` for anomalies

### GitHub Repository Management

- **Branch protection** on all public repos: no force push, no branch deletion on main
- **Private repos** (sdk, fabric-forge, pipelines): branch protection when org upgrades to Team plan
- **Secrets**: never in code, always in Kubernetes secrets or GitHub secrets
- **Image org**: `ghcr.io/git-fabric/` for all fabric images

### ArgoCD Integration

When deploying via ArgoCD (cortex-gitops pattern):
- Changes go to the gitops repo, not directly to the cluster
- ArgoCD syncs on 3-minute poll cycle
- Auto-sync, self-heal, and prune are enabled
- The gitops commit IS the change record — commit message must reference the issue ID
- No `kubectl apply` for anything ArgoCD manages

### Ansible Integration (Future)

When Ansible is adopted for provisioning:
- Playbooks live in a dedicated repo with the same PR workflow
- Ansible changes follow the same Document → Branch → PR → Approve cycle
- Inventory and vault files are never committed in plaintext
- Playbook runs are logged and auditable

### What Requires an ADR vs a Change Request

| Change Type | Process |
|------------|---------|
| New fabric capability | AI-ADR (new ADR required) |
| New AI vendor or model | AI-ADR-009 amendment + new AI-ADR |
| Write access for any fabric | Dedicated ADR |
| New deployment target (ArgoCD, Ansible) | ADR amendment |
| Bug fix | Change request + PR |
| Configuration change | Change request + PR |
| Dependency update | Change request + PR |
| Documentation update | Branch + PR (no change request needed) |

## Security Controls

- **Branch protection** — no force push on main across all repos
- **PR requirement** — all code changes reviewed before merge
- **Immutable tags** — image tags never overwritten
- **Audit trail** — git history + PR history + change log
- **Deployment via charts** — no ad-hoc kubectl changes

## Compliance Mapping

| Framework | Control |
|-----------|---------|
| NIST AI RMF — Govern | Change management policies documented and enforced |
| ISO 42001 — AI Governance | Development lifecycle documented |
| ISO 27001 — Change Management | Change requests, approvals, and audit trail |
| SOC 2 — Change Management | PRs provide documented approval workflow |

## Consequences

**Positive:**
- Every change is documented, reviewed, and traceable
- No undocumented changes can reach production
- Audit trail supports compliance and incident investigation
- Image tag immutability prevents "works on my machine" deploy issues

**Negative:**
- PR workflow adds time to every change (deliberate trade-off)
- Emergency fixes still require a PR (no bypass mechanism by design)
- Branch protection on private repos requires paid GitHub plan

## References

- ADR-003 §1: Spec-driven development
- ADR-003 §4: Deployment safety
- ADR-003 §9: Change order process
- Makefile: `Makefile` (build and deploy targets)
- Change log: Memory file `fabric-sdk-issues.md`
