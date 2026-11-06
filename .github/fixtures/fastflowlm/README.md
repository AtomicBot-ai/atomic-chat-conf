# FastFlowLM staging and consumer fixtures

These are **unqualified candidates**, never production offers. Production
builds, recipes and the FLM collection are empty until OpenSpec 1.6. No stock
FLM binary is supplied or implied to support Atomic local-only protocol 1.

## Chat candidates

Use the `chat` fixture for the XDNA2 chat candidates below. Sizes are
the total file-plan bytes on disk rounded to decimal GB. Context is FLM's
default in the pinned registry. Actual latency and answer quality still need
on-device evaluation.

### Compact desktop candidates

- `qwen3.5:0.8b` — 0.78 GB. First desktop bring-up candidate.
- `lfm2.5-tk:1.2b` — 1.01 GB. LiquidAI's small thinking checkpoint.
- `lfm3:1.7b` — 1.63 GB. Compact general chat model.
- `qwen3.5:2b` — 2.02 GB. Larger general chat candidate for the same device.
- `minicpm-v-4.7:1b` — 2.23 GB. Includes the vision weights required by FLM. Atomic qualification targets text chat.

The four new candidates have a 32K default context. Both Qwen3.5 variants pin
the registry's `flm_q4k_high_precision` branch by commit. FastFlowLM reports
40.30 and 27.18 output tokens/s at 4K context on a Ryzen AI 7 350 with 32 GB
for the 0.8B and 2B models. [Qwen3.5 benchmark](https://github.com/ROCm/FastFlowLM/blob/f37cdd29edc777cf3db1e385da8e7bfadc57d0b3/docs/docs/benchmarks/qwen3.5_results.md)

### Larger candidates with upstream hardware runs

Reported speeds below are output tokens/s at 4K context. RAM is the installed
system memory of the benchmark host. Minimum free memory and first successful
chat still need measurement on each Atomic target.

- `gemma4-it:12b` — 9.35 GB on disk, 32K default. Ryzen AI 7 350, 32 GB RAM, 6.2 tokens/s. [Benchmark](https://github.com/ROCm/FastFlowLM/blob/f37cdd29edc777cf3db1e385da8e7bfadc57d0b3/docs/docs/benchmarks/gemma4_results.md)
- `qwen3.8-mtp:27b` — 18.07 GB on disk, 4K default. Ryzen AI 5 340, 64 GB RAM, 1.50 tokens/s and 34.34 s to first token. Keep for capacity testing on this class of machine. [Benchmark](https://github.com/ROCm/FastFlowLM/blob/f37cdd29edc777cf3db1e385da8e7bfadc57d0b3/docs/docs/benchmarks/qwen3.8_results.md)
- `qwen3.6-moe:35b-a3b` — 22.07 GB on disk, 32K default. Ryzen AI 7 350, 96 GB RAM, 16.59 tokens/s. The plan pins `flm_q4k_high_precision`; the published benchmark used an earlier FLM build. [Benchmark](https://github.com/ROCm/FastFlowLM/blob/f37cdd29edc777cf3db1e385da8e7bfadc57d0b3/docs/docs/benchmarks/qwen3.6_results.md)
- `nemotron3.5-bolt:e4b` — 9.09 GB on disk, 32K default. Ryzen AI MAX+ PRO 395, 128 GB RAM, 11.9 tokens/s using an upstream local build. [Benchmark](https://github.com/ROCm/FastFlowLM/blob/f37cdd29edc777cf3db1e385da8e7bfadc57d0b3/docs/docs/benchmarks/nemotron3.5-bolt_results.md)

Each plan under `model-candidates/` pins all required model files, the chat template,
licensing materials and that model's kernels from the [FLM v1.0.11 source tree](https://github.com/ROCm/FastFlowLM/tree/f37cdd29edc777cf3db1e385da8e7bfadc57d0b3/src).
Large-file hashes come from pinned HF LFS records. GitHub kernel hashes come
from the corresponding Git blobs. Gemma's model card declares Apache-2.0;
its package includes the standard text from SPDX. The initial qualification
target for these models is text chat. The LFM3 package's optional upstream checksum
list has an outdated entry for `config.json`. Its install plan omits that list
and pins the SHA-256 of the actual config bytes at the [model revision](https://huggingface.co/FastFlowLM/LFM3-1.7B-NPU2/tree/e21accc3f02fcbabae964d50082eea595c1642c1).
The separate `candidate` fixture continues
to supply Qwen3 0.6B for core's offline smoke test.

### Qwen3 0.6B hardware evidence

`model-candidate.json` lists 12 files (696,580,018 bytes) for Qwen3 0.6B NPU2.
Weights, config, tokenizer, chat template, model card and `lm_head.xclbin` come from
the pinned Hugging Face model. The model's Apache-2.0 license comes from Qwen.
The four kernels `attn.xclbin`, `dequant.xclbin`, `layer.xclbin` and `mm.xclbin`
come from `src/xclbins/Qwen3-0.6B-NPU2/` of FastFlowLM v1.0.11. Install their
`LICENSE_BINARY.txt` from the same commit alongside the unmodified files.

On an Arch Linux Krackan 1 NPU the original HF kernel set timed out twice on
the first chat request. Replacing these four files as a set produced an offline
completion with the same weights and executable. The 32768-token context is
upstream metadata. Chat is the qualification target. Windows and the Ubuntu
preparation matrix still require live evidence.

- [FastFlowLM kernel tree](https://github.com/ROCm/FastFlowLM/tree/f37cdd29edc777cf3db1e385da8e7bfadc57d0b3/src/xclbins/Qwen3-0.6B-NPU2)
- [Model files](https://huggingface.co/FastFlowLM/Qwen3-0.6B-NPU2/tree/b584799232c962f693e0e5be99606fc4eca6811e)
- [Model license](https://huggingface.co/Qwen/Qwen3-0.6B/blob/c1899de289a04d12100db370d81485cdf75e47ca/LICENSE)

`evidence/github-kernel-metadata.json` records the Git object IDs, byte sizes
and SHA-256 hashes of the five files from the FLM commit, computed from
`git show <commit>:<source_path>`. The HF evidence records the pinned metadata,
LFS content hashes and the contents of small files.

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
# Use chat for the desktop and larger candidates. Other modes: old-cache (no FLM collection), unknown (future entry/collection), production.
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
