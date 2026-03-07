# Fabric-SDK Build & Deploy
# ADR-003 §4: Immutable tags, linux/amd64, no shortcuts
#
# Usage:
#   make build-gateway          # build + push gateway (auto-increments patch version)
#   make build-gateway TAG=0.2.0  # explicit tag
#   make deploy-gateway         # helm upgrade to latest built tag
#   make test                   # run enforcement test suite

REGISTRY := ghcr.io/git-fabric
PLATFORM := linux/amd64
NAMESPACE := fabric-sdk

# ── Gateway ───────────────────────────────────────────────────────

GATEWAY_IMAGE := $(REGISTRY)/gateway

# Auto-detect latest tag from git tags, increment patch
GATEWAY_TAG ?= $(shell git tag -l 'gateway-*' --sort=-v:refname | head -1 | sed 's/gateway-//' || echo "0.1.0")
GATEWAY_NEXT := $(shell echo $(GATEWAY_TAG) | awk -F. '{printf "%s.%s.%s", $$1, $$2, $$3+1}')

.PHONY: build-gateway deploy-gateway test

build-gateway:
	@TAG=$${TAG:-$(GATEWAY_NEXT)}; \
	echo "Building $(GATEWAY_IMAGE):$$TAG ($(PLATFORM))"; \
	docker buildx build \
		--platform $(PLATFORM) \
		-f packages/gateway/Dockerfile \
		-t $(GATEWAY_IMAGE):$$TAG \
		--push . && \
	git tag "gateway-$$TAG" && \
	echo "Tagged: gateway-$$TAG" && \
	echo "Image: $(GATEWAY_IMAGE):$$TAG"

deploy-gateway:
	@TAG=$${TAG:-$(shell git tag -l 'gateway-*' --sort=-v:refname | head -1 | sed 's/gateway-//')}; \
	echo "Deploying gateway $$TAG to $(NAMESPACE)"; \
	helm upgrade fabric-gateway charts/fabric-gateway \
		-n $(NAMESPACE) \
		--set image.tag=$$TAG && \
	kubectl rollout status deploy/fabric-gateway -n $(NAMESPACE) --timeout=90s && \
	echo "Gateway $$TAG deployed"

restart-fabrics:
	kubectl rollout restart deploy/fabric-k8s deploy/fabric-aiana -n $(NAMESPACE)
	@echo "Waiting for fabrics to re-register..."
	@sleep 20
	kubectl run health-check --image=curlimages/curl --rm -i --restart=Never -n $(NAMESPACE) \
		-- curl -s http://fabric-gateway.$(NAMESPACE):7340/health 2>/dev/null | grep -v '^pod "'

test:
	@if [ -f /tmp/fabric-test.sh ]; then \
		bash /tmp/fabric-test.sh; \
	else \
		echo "Test suite not found at /tmp/fabric-test.sh"; \
		exit 1; \
	fi

# ── Helm chart location (fabric-forge repo) ──────────────────────
# Charts live in fabric-forge/fabric-forge, not in this repo.
# The deploy targets assume charts/ is symlinked or the fabric-forge
# repo is checked out at the expected path.
charts/fabric-gateway:
	@echo "Helm charts not found. Clone fabric-forge/fabric-forge to /tmp/fabric-forge"
	@echo "and symlink: ln -s /tmp/fabric-forge/charts charts"
	@exit 1
