# atomic-chat-conf — remote configuration consumed by Atomic Chat at runtime.
#
# The mirror targets drive .github/workflows/mirror-upstream.yml, which takes a
# ggml-org/llama.cpp release tag, re-signs the Windows and macOS binaries with
# our certificates, publishes them as a release here and repoints
# backends/manifest.json at them.

REPO ?= AtomicBot-ai/atomic-chat-conf
RETAIN ?= 3
UPSTREAM_BASE = https://github.com/ggml-org/llama.cpp/releases/download

.PHONY: help mirror mirror-select mirror-local-macos verify-release validate

help:
	@echo "Targets:"
	@echo "  make mirror TAG=b10405        Mirror + sign an upstream release (runs CI, waits for it)"
	@echo "  make mirror-select TAG=b10405 Show which assets that tag would mirror (no side effects)"
	@echo "  make mirror-local-macos TAG=b10405"
	@echo "                                Sign the macOS asset locally; needs a Developer ID in the keychain"
	@echo "  make verify-release TAG=b10405 Check the published release is signed as expected"
	@echo "  make validate                 Validate every manifest against its schema"
	@echo ""
	@echo "Variables: RETAIN=$(RETAIN) (releases kept), REPO=$(REPO)"

# Signing has to happen on native runners: signtool and the DigiCert KeyLocker
# KSP exist only on Windows, codesign only on macOS. One local command cannot
# cover both platforms, so this is a thin wrapper around the workflow.
mirror:
	@test -n "$(TAG)" || { echo "Usage: make mirror TAG=b10405"; exit 1; }
	@echo "$(TAG)" | grep -Eq '^b[0-9]+$$' || { echo "TAG must look like b10405"; exit 1; }
	gh workflow run mirror-upstream.yml --repo $(REPO) \
		-f tag=$(TAG) -f retain=$(RETAIN)
	@echo "Waiting for the run to be queued..."
	@sleep 6
	@RUN_ID=$$(gh run list --repo $(REPO) --workflow mirror-upstream.yml \
		--limit 1 --json databaseId --jq '.[0].databaseId'); \
	echo "Watching run $$RUN_ID"; \
	gh run watch "$$RUN_ID" --repo $(REPO) --exit-status

mirror-select:
	@test -n "$(TAG)" || { echo "Usage: make mirror-select TAG=b10405"; exit 1; }
	@node .github/scripts/mirror.mjs select --tag $(TAG) >/dev/null

# Emergency path and debugging aid: produces the same macOS artifact the
# workflow would, using whatever Developer ID is in the local keychain. The
# Windows assets cannot be done this way.
mirror-local-macos:
	@test -n "$(TAG)" || { echo "Usage: make mirror-local-macos TAG=b10405"; exit 1; }
	@test "$$(uname -s)" = "Darwin" || { echo "macOS only"; exit 1; }
	@set -eu; \
	ASSET="llama-$(TAG)-bin-macos-arm64.tar.gz"; \
	IDENTITY=$$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)".*/\1/'); \
	test -n "$$IDENTITY" || { echo "No Developer ID Application identity in the keychain"; exit 1; }; \
	echo "Signing identity: $$IDENTITY"; \
	WORK=$$(mktemp -d); \
	trap 'rm -rf "$$WORK"' EXIT; \
	echo "Downloading $$ASSET..."; \
	curl -fSL --retry 5 --retry-delay 3 -o "$$WORK/$$ASSET" "$(UPSTREAM_BASE)/$(TAG)/$$ASSET"; \
	mkdir -p "$$WORK/extract"; \
	tar -xzf "$$WORK/$$ASSET" -C "$$WORK/extract"; \
	ROOT=$$(cd "$$WORK/extract" && ls -1); \
	SIGNED=0; \
	for bin in $$(find "$$WORK/extract/$$ROOT" -type f); do \
		if file "$$bin" | grep -q "Mach-O"; then \
			codesign --force --options runtime --timestamp \
				--entitlements .github/entitlements.plist \
				--sign "$$IDENTITY" "$$bin"; \
			codesign --verify --strict "$$bin"; \
			SIGNED=$$((SIGNED + 1)); \
		fi; \
	done; \
	test "$$SIGNED" -gt 0 || { echo "No Mach-O binaries found"; exit 1; }; \
	echo "Signed $$SIGNED Mach-O binaries"; \
	tar -czf "$$PWD/$$ASSET" -C "$$WORK/extract" "$$ROOT"; \
	echo "Wrote $$PWD/$$ASSET"; \
	echo "Upload it with: gh release upload $(TAG) $$ASSET --clobber --repo $(REPO)"

verify-release:
	@test -n "$(TAG)" || { echo "Usage: make verify-release TAG=b10405"; exit 1; }
	@set -eu; \
	WORK=$$(mktemp -d); \
	trap 'rm -rf "$$WORK"' EXIT; \
	gh release download $(TAG) --repo $(REPO) --dir "$$WORK" \
		--pattern 'llama-$(TAG)-bin-macos-arm64.tar.gz'; \
	tar -xzf "$$WORK/llama-$(TAG)-bin-macos-arm64.tar.gz" -C "$$WORK"; \
	ROOT=$$(cd "$$WORK" && ls -1d llama-$(TAG)); \
	echo "=== macOS signature:"; \
	codesign -dv --verbose=2 "$$WORK/$$ROOT/llama-server" 2>&1 | grep -E "Authority|TeamIdentifier|flags"; \
	codesign --verify --strict "$$WORK/$$ROOT/llama-server"; \
	echo "macOS asset OK. Windows assets need 'signtool verify /pa' on a Windows host."

validate:
	npx --yes ajv-cli@5 validate -s providers/schema.json -d providers/registry.json --strict=false
	npx --yes ajv-cli@5 validate -s models/schema.json -d models/recommended.json --strict=false
	npx --yes ajv-cli@5 validate -s models/schema.staff-picks.json -d models/staff-picks.json --strict=false
	npx --yes ajv-cli@5 validate -s backends/schema.json -d backends/manifest.json --strict=false
	npx --yes ajv-cli@5 validate -s backends/turboquant-schema.json -d backends/turboquant-manifest.json --strict=false
