# FastFlowLM staging and consumer fixtures

These are **unqualified candidates**, never production offers. Production
builds, recipes and the FLM collection are empty until OpenSpec 1.6. No stock
FLM binary is supplied or implied to support Atomic local-only protocol 1.

## Model candidate

`model-candidate.json` is Qwen3 0.6B NPU2: 11 files, 696,558,525 bytes. The full
plan includes five model-specific `.xclbin` kernels, weights, tokenizer/config,
the embedded chat template, model card and license. Sources:

- FastFlowLM v1.0.11, commit `f37cdd29edc777cf3db1e385da8e7bfadc57d0b3`:
  https://github.com/ROCm/FastFlowLM/blob/f37cdd29edc777cf3db1e385da8e7bfadc57d0b3/src/model_list.json
- Model: https://huggingface.co/FastFlowLM/Qwen3-0.6B-NPU2/tree/b584799232c962f693e0e5be99606fc4eca6811e
- License: https://huggingface.co/Qwen/Qwen3-0.6B/blob/c1899de289a04d12100db370d81485cdf75e47ca/LICENSE

`evidence/hf-*.json` preserves metadata from these revisions. Small files are
stored under `evidence/` and SHA-256 is computed over their actual bytes. Large
files use the pinned HF LFS SHA-256; weights have not been downloaded or run.
The model's 32768-token context is upstream metadata, not a measured capacity.
Chat is the intended qualification target; tools/reasoning/structured output
remain disabled until verified. The minimum Atomic build ID is a contract
requirement for future core builds, not an existing release.

## System candidates

`linux-candidates.json` pins the native NPU stack separately for Ubuntu 24.04
and 26.04. `amdxdna-dkms` includes the model-independent firmware for 17f0_10
(1.1.2.64) and 17f0_11 (1.1.2.65); the extracted archive listings are evidence.
XRT runtime, NPU plugin and diagnostic utilities are pinned separately. Every
listed `.deb` was downloaded and its size/SHA-256 matched the PPA index.
`InRelease` signatures were checked with the fingerprint reported by Launchpad:
`881CF4B40B0BFA288D6776E83BF36CFA0BD50AEC`.

The signed InRelease, original compressed Packages index and public key are
stored for reproducible offline verification. These packages do not establish
compatibility with an arbitrary running kernel. Core must resolve/check matching
headers, base OS dependencies and Secure Boot, then qualify firmware selection,
XRT ABI, NPU visibility, runtime-account permissions/memlock and inference. No
kernel replacement, global memlock rule or installer command is prescribed here.

`windows-candidate.json` pins the AMD NPU driver from Microsoft Update Catalog.
Its supported device ID is deliberately narrow; do not generalize it to all
XDNA2 devices. The cabinet is a candidate for a fixed native driver-install action,
not a proven unattended AMD installer. The PKCS#7 signature integrity and inclusion of the INF SHA-256 in the signed
catalog were verified. The publisher certificate expired in February 2026;
Windows timestamp/revocation/kernel-trust policy must be checked natively before
qualification. Installation on Windows remains part of core qualification. Nothing here installs a driver.

## Unmerged conf sources (D8)

Materialize a complete catalog plus the three empty managed manifests:

```sh
node .github/scripts/fastflowlm-fixtures.mjs /tmp/fastflowlm-conf candidate
# Other modes: old-cache (no FLM collection), unknown (future entry/collection), production.
export ATOMIC_MODEL_CATALOG_URL=file:///tmp/fastflowlm-conf/catalog.json
export ATOMIC_FASTFLOWLM_MANIFEST_URL=file:///tmp/fastflowlm-conf/fastflowlm-manifest.json
export ATOMIC_FASTFLOWLM_ENVIRONMENT_MANIFEST_URL=file:///tmp/fastflowlm-conf/fastflowlm-linux.json
# Windows consumer: use fastflowlm-windows.json instead.
```

These variable names are the agreed **future core/consumer override contract**;
this conf change does not implement environment-variable loading in old clients.
Core task 3.1/4.2 must wire them. Atc uses injected dependencies/env on its server;
desktop uses its catalog-service/Tauri relay source configuration. Never use
browser fetch(file://), and never patch production URL constants to test a branch.
A candidate must be explicitly accepted in a development path; the production
validator rejects it. The empty build list still prevents an installable runtime.

For HTTPS, serve the same directory with a trusted local development certificate:

```sh
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -keyout /tmp/fastflowlm-key.pem -out /tmp/fastflowlm-cert.pem \
  -subj /CN=localhost -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1'
node .github/scripts/fastflowlm-fixture-server.mjs /tmp/fastflowlm-conf \
  /tmp/fastflowlm-key.pem /tmp/fastflowlm-cert.pem
# Replace file:///tmp/fastflowlm-conf/ with https://localhost:8443/ in the overrides.
# Node consumer: NODE_EXTRA_CA_CERTS=/tmp/fastflowlm-cert.pem; never disable TLS verification.
```

The server binds loopback only and serves the four generated filenames. Browser
or desktop clients need their normal trusted-certificate configuration/relay.
`make validate` requires Node 22+, ajv-cli (via npx), OpenSSL and GnuPG/gpgv.
It verifies package-source signatures offline and checks file/HTTPS equivalence with an ephemeral trusted CA and
runs the pinned pre-FLM core parser unchanged. Its exact commit and source hash
are in `legacy-model-catalog.provenance.json`. These contract tests do not prove
that unreleased app/core/cli source overrides or NPU inference already work.

## Promotion

Do not copy these candidates wholesale to production. First obtain core's
managed build/provenance and live reports for Windows 11, Ubuntu 24.04 and 26.04.
Reverify URLs, SHA-256, device/kernel/package combinations and capability claims,
then create qualified entries with evidence and new immutable IDs. Tasks 1.6
and 1.7 remain open; no merge, publication or production URL change is authorized
by fixture generation.
