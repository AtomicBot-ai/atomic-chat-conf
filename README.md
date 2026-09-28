# Atomic Chat — Configuration Registry

This repository hosts **runtime configuration** consumed by the Atomic Chat
desktop client. The client fetches the manifest at startup and refreshes it
periodically, so changes here propagate to all installed Atomic Chat clients (macOS,
Windows, Linux) without an application release.

> **TL;DR for non-developers** — to add a new model or provider, edit
> [`providers/registry.json`](providers/registry.json) on GitHub, open a Pull
> Request, get it reviewed, merge it. All running Atomic Chat clients will pick up the
> change within an hour.

---

## Repository layout

```
providers/
  registry.json      # Single source of truth for cloud providers
  schema.json        # JSON Schema (Draft-07) used by CI validation
models/
  recommended.json   # Recommended models surfaced in onboarding (frozen shape)
  schema.json        # JSON Schema (Draft-07) for the recommended-models manifest
  staff-picks.json   # Curated Staff Picks list shown by default in Hub
  schema.staff-picks.json # JSON Schema (Draft-07) for the staff-picks manifest
backends/
  manifest.json            # llama.cpp backend catalog (mirrors a ggml-org release)
  schema.json              # JSON Schema (Draft-07) for the backends manifest
  turboquant-manifest.json # TurboQuant backend catalog (one unified release tag)
  turboquant-schema.json   # JSON Schema (Draft-07) for the TurboQuant manifest
runtimes/
  tensorrt-llm.json  # TensorRT-LLM managed-engine runtime descriptor
  schema.json        # JSON Schema (Draft-07) for a runtime descriptor
.github/
  workflows/validate.yml        # Validates every manifest on every PR
  workflows/mirror-upstream.yml # Mirrors + signs an upstream llama.cpp release
  actions/windows-code-sign/    # Authenticode signing via DigiCert KeyLocker
  scripts/mirror.mjs            # Asset whitelist + manifest generation
  entitlements.plist            # Entitlements for the signed macOS binaries
Makefile                        # make mirror TAG=... and friends
README.md
```

Future configuration domains (themes, default prompts, etc.) will live in
sibling directories such as `themes/`, `prompts/`, and so on. Each domain
gets its own subdirectory and its own schema.

## What lives in the registry

The registry only describes **cloud providers** that need API keys (OpenAI,
Anthropic, OpenRouter, Mistral, Groq, xAI, Gemini, MiniMax, Hugging Face,
NVIDIA, …).

The following are **not** in the registry and must not be added:

| Excluded                         | Why                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| Local providers (llama.cpp, etc) | Discovered at runtime by the client's engine manager.                                            |
| `azure`                          | Kept inside the client as a baseline fallback — it requires per-resource configuration.          |
| API keys                         | Must always remain on the user's machine. The `api_key` field MUST be `""` in the registry.      |

## How the Atomic Chat client uses the registry

```
raw.githubusercontent.com/AtomicBot-ai/atomic-chat-conf/main/providers/registry.json
                              │
                              ▼ fetched once per hour (TTL = 1h)
                ┌─────────────────────────────────┐
                │  Atomic Chat client (web-app)   │
                │  - validates schema_version     │
                │  - merges with `azure`          │
                │  - caches in localStorage       │
                └─────────────────────────────────┘
```

If the network is unreachable or the manifest is malformed, the client falls
back to its built-in baseline (`azure` only) plus whatever was previously
cached. The application never crashes due to a registry issue.

## How to add a new model to an existing provider

1. Open [`providers/registry.json`](providers/registry.json) on GitHub.
2. Click the pencil icon ("Edit").
3. Find the provider block (for example, `"provider": "openrouter"`).
4. Add a new entry to its `models` array, copying the shape of an existing
   entry. Example:
   ```json
   {
     "id": "openai/gpt-5.5",
     "name": "GPT-5.5",
     "version": "1.0",
     "description": "Short, factual one-liner. 1M ctx, vision + tools.",
     "capabilities": ["completion", "tools", "vision"]
   }
   ```
5. Bump `updated_at` at the top of the file to today (`YYYY-MM-DDTHH:MM:SSZ`).
6. Commit the change to a new branch and open a Pull Request.
7. Wait for CI ("Validate registry") to pass — it checks the file against
   `schema.json`.
8. Request a review and merge.

## How to add a brand-new provider

The same as above, but you add a whole provider object to the top-level
`providers` array. Use any existing provider as a template. Required fields:

- `provider` — short, lowercase, unique id (e.g. `cohere`).
- `base_url` — OpenAI-compatible base URL.
- `settings` — at minimum, an `api-key` and `base-url` controller pair.
- `models` — may be `[]` if you want users to discover models manually.
- `api_key` — **always** `""`.

If your provider needs extra HTTP headers (Anthropic does, for example), use
the optional `custom_header` array.

### Controlling live model listing (`supports_model_listing`)

The client's **Refresh (↻)** button on a provider page is hybrid: it merges
this curated registry list with whatever the provider returns from a live
`GET /v1/models`, deduped by id. This is what lets custom / self-hosted
providers (vLLM, llama.cpp, LM Studio, …) surface their real model ids.

For a few clouds the live `/v1/models` endpoint returns hundreds of
junk/internal ids that would pollute the picker. To opt such a provider out of
the live probe, set the optional boolean:

```json
"supports_model_listing": false
```

- `true` (or the field omitted) → registry list ∪ live `/v1/models` (default).
- `false` → curated registry list only; the client never calls `/v1/models`.

This is backwards-compatible — older clients simply ignore the field — so it
does **not** require a `schema_version` bump.

## Capabilities

The `capabilities` array on each model uses these values:

| Value         | Meaning                                                  |
| ------------- | -------------------------------------------------------- |
| `completion`  | Standard chat / completion endpoint.                      |
| `tools`       | Native function-calling / tool-use support.               |
| `vision`      | Accepts image inputs.                                     |
| `embeddings`  | Embedding endpoint available for this model.              |
| `reasoning`   | Exposes structured `reasoning_details` (e.g. DeepSeek R1).|

## Schema versioning

Every manifest carries a top-level `schema_version`. The Atomic Chat client embeds
its highest supported version. If you ship a manifest whose `schema_version`
exceeds what older clients understand, they will fall back to their cached or
baseline manifest and prompt the user to update Atomic Chat.

**Bump `schema_version` only when adding new required fields or changing the
shape of existing fields in a backwards-incompatible way.** Adding a new
provider or new model never requires a bump.

## Recommended models

[`models/recommended.json`](models/recommended.json) drives the **Recommended**
section in two places of the Atomic Chat client:

1. The **Hub** screen (`/hub`).
2. The first-run **Setup / onboarding** screen.

Each entry is a small object — only the model id and the i18n key for the
chip label live here. The full Hugging Face metadata (quants, mmproj, file
sizes) is fetched at runtime from `huggingface.co`. A bundled, slim
fallback in the client covers the offline first launch.

Entry shape (full schema in [`models/schema.json`](models/schema.json)):

```json
{
  "model_name": "unsloth/gemma-4-E4B-it-GGUF",
  "description_key": "hub:recEverydayUse",
  "platforms": ["macos", "windows", "linux"],
  "active": true
}
```

| Field             | Required | Notes                                                                                       |
| ----------------- | -------- | ------------------------------------------------------------------------------------------- |
| `model_name`      | yes      | Hugging Face repo id (`owner/name`).                                                         |
| `description_key` | yes      | i18n key for the chip label. Must start with `hub:` and exist in the client's `hub.json`s.   |
| `platforms`       | no       | Subset of `["macos", "windows", "linux"]`. **Omit to show on every platform.**               |
| `active`          | no       | Defaults to `true`. Set to `false` to hide an entry without deleting it.                     |

### Currently supported `description_key` values

These keys are translated in
[`web-app/src/locales/*/hub.json`](https://github.com/AtomicBot-ai/Atomic-Chat/tree/main/web-app/src/locales)
and mapped to chip colors in `web-app/src/constants/recommendedModelChip.ts`:

| Key                       | Chip color | English label        |
| ------------------------- | ---------- | -------------------- |
| `hub:recEverydayUse`      | green      | Everyday use         |
| `hub:recVisionKnowledge`  | purple     | Vision & knowledge   |
| `hub:recFinetuningChat`   | blue       | Fine-tuning & chat   |
| `hub:recMathReasoning`    | yellow     | Math & reasoning     |
| `hub:recForMlx`           | orange     | For MLX              |

Adding a brand-new `description_key` requires both adding the translation in
the Atomic-Chat repo **and** publishing a client release — until then, older
clients render the entry with a neutral gray chip.

### Platform-aware recommendations

`platforms` is purely a presentation hint:

- **MLX models** (anything from the `mlx-community` org or marked as
  `library_name: "mlx"`) only run on macOS — list them with
  `"platforms": ["macos"]`.
- **GGUF models** generally run everywhere; setting `platforms` lets you
  promote a different default for Windows/Linux users (e.g. recommend
  Llama 3.1 GGUF on Windows when MLX is not an option).

The Atomic Chat client filters this list locally based on the host OS
before rendering.

### High-memory recommendation tiers

The client and manifest distinguish `*_64`, legacy `*_64_plus` (between 64
and nominal 128 GiB), `*_128`, and `*_128_plus`. The ids apply separately to
`vram_` (largest single GPU) and `unified_` (Mac/ARM shared memory). Nominal
128 allows reporting tolerance: 127–129 GiB VRAM and 127.5–128.5 GiB unified,
with exclusive upper edges. The existing 64 edges stay at 65 and 64.5 GiB.
Ship the client with the new vocabulary before publishing this manifest;
schema version stays 1 because old clients ignore unknown tier keys and keep
using `*_64_plus` and the original recommendation lists.

Each high tier has an ordered lead, a Gemma 4 31B vision alternative with its
F16 projector pinned, and another text/coding option. The larger options trade
memory and download size for model capacity; this is not a throughput ranking.
The AtomicChat Qwen3.6 mirrors have no projector and are offered for text.

[File evidence](.github/fixtures/high-tier-files.json) records exact HF file
sizes, revision ids, and LFS hashes checked on 2026-09-17, including every shard.
`node --test .github/scripts/recommendation-tiers.test.mjs` checks the pins,
complete shard sets, local catalog membership, and weight-plus-projector fit
at each tier's lower edge. macOS's load ceiling is 85% of unified memory;
weights within 50% are comfortable by the client rule. Other platforms use the
whole pool before warning about spill. Neither rule guarantees runtime fit at
arbitrary context lengths. Refresh the evidence when rotating these choices.

### How to add or update a recommendation

1. Open [`models/recommended.json`](models/recommended.json) on GitHub.
2. Click the pencil icon ("Edit").
3. Append (or modify) an entry following the shape above.
4. Bump `updated_at` to today (`YYYY-MM-DDTHH:MM:SSZ`).
5. Commit to a new branch and open a Pull Request.
6. Wait for CI ("Validate registry") to pass — it runs the JSON Schema
   plus a duplicate-entry check against `models/recommended.json`.
7. Request a review and merge.

All running Atomic Chat clients pick up the change within an hour.

## Staff picks

[`models/staff-picks.json`](models/staff-picks.json) drives the **Staff picks**
list that the Hub screen (`/hub`) shows by default, before the user types a
search query. It is deliberately a **separate file** from
`models/recommended.json`: shipped production clients reject a manifest whose
`schema_version` is higher than the one they were built against, so the
recommended-models manifest is frozen at version 1 with its original entry
shape. Staff picks get their own file, their own schema, and their own
version dial.

Entry shape (full schema in
[`models/schema.staff-picks.json`](models/schema.staff-picks.json)):

```json
{
  "model_name": "AtomicChat/Qwen3.6-27B-GGUF",
  "title": "Qwen3.6 27B",
  "summary": "Prioritizes stability and real-world coding quality.",
  "description_key": "hub:recCoding",
  "icon": "qwen",
  "format": "gguf",
  "categories": ["reasoning", "coding", "tools"],
  "order": 80,
  "active": true
}
```

| Field             | Required | Notes                                                                                          |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `model_name`      | yes      | Hugging Face repo id (`owner/name`).                                                            |
| `title`           | no       | Display name override. Falls back to the name derived from the repo id.                         |
| `summary`         | no       | One-line English description shown on the row.                                                  |
| `description_key` | no       | i18n key for the chip label. Must start with `hub:`. Takes priority over `summary` for the chip.|
| `icon`            | no       | Bundled icon key. Unknown keys fall back to the model-family logo, then to a letter.            |
| `format`          | no       | `gguf` (default) or `mlx`. Decides which picks the Hub resolves at all — see below.             |
| `categories`      | no       | Capability pills: `general`, `reasoning`, `coding`, `vision`, `tools`, `compact`, `multilingual`.|
| `platforms`       | no       | Subset of `["macos", "windows", "linux"]`. **Omit to show on every platform.**                  |
| `order`           | no       | Lower sorts first; entries without an order sort last. Must be unique.                          |
| `active`          | no       | Defaults to `true`. Set to `false` to hide a pick without deleting it.                          |

### GGUF and MLX entries

A model that ships both a GGUF and an MLX build gets **two entries**. The Hub
shows the GGUF one by default and swaps to the MLX one only while the MLX
format filter is selected, so the list never carries the same model twice.

`format` has to be declared rather than inferred from the repo id, because the
client uses it to decide which picks to resolve: an entry that is off screen
costs neither a catalog lookup nor a Hugging Face request. Give the MLX entry
`"platforms": ["macos"]` (CI rejects an MLX pick without it), the same `order`
as its GGUF twin plus 5, and `"description_key": "hub:recForMlx"`.

Editing flow is identical to the recommended-models manifest: edit on GitHub,
bump `updated_at`, open a PR, wait for the "Validate registry" workflow.

## llama.cpp backends manifest

[`backends/manifest.json`](backends/manifest.json) is the catalog of
downloadable `llama.cpp` backend builds the Atomic Chat client offers on
**Windows, Linux x64 and Apple Silicon**. It exists to dodge GitHub's unauthenticated API
rate limit (60 req/hr/IP): the client used to resolve the backend list
straight from `api.github.com/repos/ggml-org/llama.cpp/releases/latest`,
which dead-ended on shared / NAT / VPN networks (see ATO-199). It now reads
this static file via `raw.githubusercontent.com`, which has no per-IP limit.

The file **mirrors the shape of a GitHub release JSON** (`tag_name` +
`assets[].name`) so the client reuses its existing asset-name parser
verbatim — only the source URL changed.

The archives themselves are served from **this repository's own releases**,
where the Windows and macOS binaries carry Atomic Chat's signatures — see
[Signed mirror](#signed-mirror) below. `download_base` names that stream;
drop the field and the client falls back to the upstream ggml-org CDN, which
is what a tag we have not mirrored has to do.

```json
{
  "$schema": "./schema.json",
  "updated_at": "2026-06-17T00:00:00Z",
  "tag_name": "b9691",
  "download_base": "https://github.com/AtomicBot-ai/atomic-chat-conf/releases/download",
  "assets": [
    {
      "name": "llama-b9691-bin-win-cpu-x64.zip",
      "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
      "size": 18468077
    },
    { "name": "cudart-llama-bin-win-cuda-12.4-x64.zip" }
  ]
}
```

- `$schema` / `updated_at` are advisory; the client reads `tag_name`,
  `download_base` and `assets[]`, so the GitHub-mirror shape is preserved.
- `sha256` and `size` are verified by the client after download and always
  travel together. An asset **without** them is one we do not host: the
  `cudart-*` companions stay on the upstream CDN (their DLLs are NVIDIA's
  own, already signed by NVIDIA, and mirroring them would triple the size of
  every release for no gain).
- Windows x64, Linux x64 and `macos-arm64` assets are listed. macOS used to be
  bundled-only and was deliberately omitted; it now resolves from this
  manifest like the other platforms, so an engine update reaches macOS users
  without an Atomic Chat release. The client still ships a bundled macOS build
  as the offline baseline and picks whichever is newer.
- **`macos-x64` is deliberately absent.** Runtime engine updates on macOS are
  Apple Silicon only. The client filters macOS assets by host architecture, so
  an Intel host resolves nothing from this manifest and stays on its bundled
  build. Adding the asset would start serving updates to Intel Macs, which is
  a product decision, not a manifest edit.
- The `cudart-*` companions are listed for completeness; the client's
  backend regex ignores them (it matches only `llama-<tag>-bin-...`), so
  they are harmless.

### Signed mirror

Upstream ships its macOS binaries ad-hoc-signed and its Windows binaries
unsigned. Atomic Chat both downloads these archives at runtime and bundles one
in its installer, so before this pipeline existed the app either shipped an
unsigned binary or re-signed it on each developer's machine. Now one CI run
per tag produces a single artifact that serves both paths.

```bash
make mirror TAG=b10405          # run the pipeline and wait for it
make mirror-select TAG=b10405   # dry run: show which assets that tag would mirror
make verify-release TAG=b10405  # check the published macOS asset's signature
```

[`.github/workflows/mirror-upstream.yml`](.github/workflows/mirror-upstream.yml)
downloads the whitelisted assets from ggml-org, signs the Windows binaries
with DigiCert KeyLocker and the macOS binaries with our Developer ID
(hardened runtime, secure timestamp), repacks each archive with its original
layout, publishes them under the upstream tag, then regenerates this manifest
with a `sha256` per asset and commits it. Linux archives pass through
byte-for-byte: there is no Linux signing mechanism here.

The manifest moves **after** the upload succeeds, never before — clients
resolve download URLs from it, so the reverse order would hand them 404s.
Older mirrored releases are pruned (`RETAIN=3` by default).

Required secrets: `SM_API_KEY`, `SM_CLIENT_CERT_FILE_B64`,
`SM_CLIENT_CERT_PASSWORD` (Windows), `APPLE_CERTIFICATE`,
`APPLE_CERTIFICATE_PASSWORD` (macOS). The temporary keychain the macOS job
creates gets a password generated on the runner, so that one is not a secret.

### How to update the backends manifest

Run `make mirror TAG=<tag>`. Pick the newest **complete** ggml-org release:
releases publish their tag before every asset finishes uploading, so do not
blindly grab `latest`. The pipeline fails loudly if a required asset is
missing from the tag, which is the check that used to be manual.

Editing `backends/manifest.json` by hand still works and still points clients
at a new engine within the hour, but a hand-written tag has no mirrored
release behind it: drop `download_base` and the `sha256` fields in that case
so the client falls back to the upstream CDN instead of resolving URLs into a
release that does not exist.

## TurboQuant backends manifest

[`backends/turboquant-manifest.json`](backends/turboquant-manifest.json) is
the catalog of downloadable **TurboQuant** `llama.cpp` builds
(`AtomicBot-ai/atomic-llama-cpp-turboquant`) the Atomic Chat client offers as
a *second* provider on **Windows and Linux x64** (alongside the upstream
provider above). It exists for the same rate-limit reason as the upstream
manifest: the index lives here so the client never has to scan
`api.github.com`.

The fork publishes **every variant of a build under one release tag**, named
`b<upstream-build>-<fork-semver>` — e.g. `b10018-1.3.0` is upstream llama.cpp
build `b10018` carrying fork version `1.3.0`. All entries therefore share the
same `tag`; the per-entry `tag` field is retained so an older scattered release
set stays expressible without a schema change.

```json
{
  "$schema": "./turboquant-schema.json",
  "updated_at": "2026-07-31T09:00:00Z",
  "commit": "5bc5c248d",
  "backends": [
    { "id": "windows-x64-cpu",       "tag": "b10018-1.3.0", "asset": "llama-turboquant-windows-x64-cpu.zip" },
    { "id": "windows-x64-cuda-12.4", "tag": "b10018-1.3.0", "asset": "llama-turboquant-windows-x64-cuda-12.4.zip" },
    { "id": "windows-x64-cuda-13.3", "tag": "b10018-1.3.0", "asset": "llama-turboquant-windows-x64-cuda-13.3.zip" },
    { "id": "windows-x64-vulkan",    "tag": "b10018-1.3.0", "asset": "llama-turboquant-windows-x64-vulkan.zip" },
    { "id": "linux-x64-cpu",         "tag": "b10018-1.3.0", "asset": "llama-turboquant-linux-x64-cpu.tar.gz" },
    { "id": "linux-x64-cuda-12.4",   "tag": "b10018-1.3.0", "asset": "llama-turboquant-linux-x64-cuda-12.4.tar.gz" },
    { "id": "linux-x64-cuda-13.3",   "tag": "b10018-1.3.0", "asset": "llama-turboquant-linux-x64-cuda-13.3.tar.gz" },
    { "id": "linux-x64-rocm",        "tag": "b10018-1.3.0", "asset": "llama-turboquant-linux-x64-rocm.tar.gz" },
    { "id": "linux-x64-vulkan",      "tag": "b10018-1.3.0", "asset": "llama-turboquant-linux-x64-vulkan.tar.gz" },
    { "id": "macos-arm64",           "tag": "b10018-1.3.0", "asset": "llama-turboquant-macos-arm64.tar.gz" }
  ]
}
```

- `id` is the clean, release-aligned backend id the client uses verbatim.
- `tag` must match `b<build>-<major>.<minor>.<patch>` and must be **identical
  across all entries**; the archive download URL is built as
  `…/releases/download/<tag>/<asset>` against the releases CDN (not rate-limited).
- `asset` must be `llama-turboquant-<id>.zip` (Windows) or
  `llama-turboquant-<id>.tar.gz` (Linux/macOS). The release also publishes
  `.zip` copies of the Linux and macOS archives — do **not** list those.
- Windows CUDA archives ship `ggml-cuda.dll` but **no** CUDA runtime DLLs, so
  the client still fetches the `cudart-*` companion from the pinned ggml-org
  release (or reuses one already installed under the upstream provider).
  Verified on `b10018-1.3.0`.
- Linux GPU tiers (`cuda-12.4`, `cuda-13.3`, `rocm`) are downloaded at runtime
  by the client; `linux-x64-vulkan` is what the installer bundles as the offline
  fallback. `linux-x64-rocm` targets RDNA2–RDNA4 and needs a host ROCm runtime,
  so the client only offers it after a conservative hardware probe.
- `macos-arm64` is **bundled into the installer**, not downloaded at runtime,
  but it is listed here so the build system resolves it from the same pin.

### How to update the TurboQuant manifest

> Also static and hand-maintained. Pick the new release tag, set the same
> `tag` on every `backends[]` entry, keep `asset` as
> `llama-turboquant-<id>.{zip,tar.gz}`, bump `commit` + `updated_at`, open a
> PR, and merge once CI is green. Consumers pin an immutable commit of this
> repository, so a merge alone does not upgrade anyone — the Atomic Chat
> client must bump its pinned revision in a deliberate compatibility change.

## Runtime descriptors (`runtimes/`)

A runtime descriptor tells atomic-chat-core which container image a
**managed engine** (currently TensorRT-LLM) runs, pinned by digest, what host
it needs, and what that release supports. It carries **data only** — no
command, script or argv lives in it: the argv for a recipe (e.g. "install a
container runtime on this Linux distro") is compiled into core itself, and a
`recipes[]` entry is only a `recipe_id` naming argv core already has, plus the
list of distributions that recipe is qualified to run on.

### Who reads this

Only atomic-chat-core **0.7.0 and later** reads `runtimes/`. Every
already-released Atomic Chat app, CLI and core build — including core
v0.6.0, which shipped before managed-engine support existed — never fetches
or parses this directory; publishing or changing a descriptor here has no
effect on them.

### `descriptor_id` is immutable

The content published under a given `descriptor_id` never changes. core
caches an accepted descriptor by this id and pins an installation to it, so
editing a published descriptor's fields in place would silently change what
an already-installed engine is compared against. Any change — the image, the
compute-capability/quantization/architecture matrices, `model_families`, the
curated model list, the distro list, or the notices — ships under a **new**
`descriptor_id` instead of editing this one.

The id format is `tensorrt-llm-<engine tag>-r<N>`: bump the engine tag when
the underlying TensorRT-LLM release changes (`tensorrt-llm-1.2.1-r1` →
`tensorrt-llm-1.3.0-r1`), or bump `N` when the tag stays the same but a
data-only field changes (a new curated model, a widened distro list, a
corrected notice, …).

### Installed engines stay pinned to their descriptor

An installation records the `descriptor_id` it was set up with and keeps
using it. Publishing a new descriptor here therefore only affects **new**
installs; an existing install is unaffected until the user removes the
engine and sets it up again, which picks up whatever descriptor is current
at that point.

### How to update the engine tag

1. Confirm the candidate tag is the latest non-rc release with the
   platform/hardware support you need — check NVIDIA's own release notes and
   hardware-support docs at that tag, not just the tag list.
2. Get the **per-platform manifest digest** for both the engine image and the
   probe image (see [Reproducing runtime descriptor
   digests](#reproducing-runtime-descriptor-digests) below) — never a
   multi-arch index digest.
3. Re-derive `supported_architectures`, `quantization`, `model_families` and
   `minimum_compute_capability` from that tag's own source (its parser
   registries, its hardware-support matrix), rather than carrying over the
   previous descriptor's values.
4. Re-derive `curated_models`: re-check each repo is still ungated, re-resolve
   `revision` to the commit its `main` branch currently points at, and
   recompute `inventory_digest` (below).
5. Recompute `download_bytes` and `required_disk_bytes` from the new image's
   registry manifests (below).
6. Update `notices` if the image's license terms changed, and `exclusions` if
   the release's support gaps changed.
7. Assign a new `descriptor_id` (`tensorrt-llm-<new tag>-r1`).
8. Run `make validate` before opening a PR — it runs the schema and every
   integrity check below against what you just wrote.

### How to add a distribution

1. Confirm **both** vendors publish packages for that distro/version/arch:
   Docker CE (`download.docker.com`) and the NVIDIA Container Toolkit
   (`nvidia.github.io/libnvidia-container`). One vendor publishing alone does
   not qualify it.
2. Only add the entry once core's live install test has actually passed on
   that distribution — package availability is a precondition, not proof the
   recipe works there.
3. Append the `{ "id", "version_id", "arch" }` entry to the relevant
   `recipes[].distributions`.
4. This is a data-only change on the same engine tag, so bump the
   `descriptor_id`'s `-r<N>` suffix.
5. `make validate`, commit, open a PR.

### Field reference (non-obvious fields)

- **The descriptor has no `$schema` key**, unlike the other manifests in this
  repository. atomic-chat-core's ported parser rejects every unknown
  top-level key, and `$schema` is not otherwise part of the descriptor's
  data — adding it would only be an editor affordance, at the cost of core
  refusing every descriptor that carries it. `runtimes/schema.json` does not
  list `$schema` among the allowed top-level properties, so `ajv --strict`
  rejects it too (see the `invalid-schema-field.json` fixture).
- **`image` / `probe_image` digests** are the **platform-specific manifest
  digest**, not the multi-arch index digest — so `docker pull repo@digest`
  fetches exactly the bytes for that platform, and core can compare what it
  actually pulled against what the descriptor promised. Pulling by the index
  digest would let the registry hand back either platform.
- **`curated_models[].vram_tier_bytes`** is the tier's nominal size in
  **decimal GB** (`× 10^9`), not binary GiB. Real cards report a little under
  their nominal binary size (an RTX 4090 reports 24,564 MiB; an H100 reports
  81,559 MiB) but still above the decimal-GB figure, so the decimal value
  works as a safe floor for "does this model fit the tier" without
  overshooting the VRAM any card in that tier actually has. On unified-memory
  systems (NVIDIA GB10 / DGX Spark) `nvidia-smi` reports no dedicated card
  memory at all, so there the tier is instead compared against the host's
  `MemAvailable` (design D13).
- **`quantization[].format` names** follow a fixed checkpoint-metadata →
  format-name mapping, documented here as the conf↔core contract. The inputs
  are the checkpoint's `config.json` content, and — when the checkpoint
  carries the file — its `hf_quant_config.json` content: a checkpoint can
  have no `quantization_config` in `config.json` at all and still be
  quantized (e.g. `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8` and
  `nvidia/Llama-3.3-70B-Instruct-NVFP4` both classify entirely from
  `hf_quant_config.json`), so `dtype`/`torch_dtype` must never be trusted
  before `hf_quant_config.json` has been checked. Apply these steps in order,
  stopping at the first that matches:
  1. If `hf_quant_config.json` is present (NVIDIA ModelOpt), the format is its
     `quantization.quant_algo` lower-cased, with `fp8_pb_wo` renamed to
     `fp8_block_scales` (matching what the engine itself calls it
     internally).
  2. Otherwise, if `config.json`'s `quantization_config.quant_method` is set:
     - `modelopt` → the format is `quantization_config.quant_algo`
       lower-cased, with the same `fp8_pb_wo` → `fp8_block_scales` rename as
       step 1.
     - `fp8` **with** `quantization_config.weight_block_size` equal to
       `[128,128]` → `fp8_block_scales`. `fp8` **without** that block size is
       **not loadable** by this engine release (`model_config.py:323`) — it
       must not fall through to step 3 and be reported as `bf16`/`fp16`.
     - `mxfp4` → `mxfp4`.
     - anything else (e.g. `awq`, `gptq`) is **not loadable** by this engine
       release and must not be listed as a supported format.
  3. Otherwise the checkpoint is unquantized: read `dtype` — the field
     TensorRT-LLM itself reads (`model_config.py:471`) — falling back to the
     legacy `torch_dtype` key only when `dtype` is absent. `bfloat16` →
     `bf16`; `float16` → `fp16`; anything else, including `float32` or a
     missing/unrecognized value, is **not loadable**.

  Each format also carries exactly one `min_compute_capability` — but the
  engine's real hardware-support matrix is not strictly monotone in compute
  capability (a format can be marked supported on a newer architecture while
  unlisted on one immediately below it), so a single floor per format is a
  conservative simplification, not a full compatibility oracle: it can let a
  checkpoint through to a load that then fails on that specific card. The
  descriptor's overall `minimum_compute_capability` is always a lower bound
  on every format's own minimum (enforced by CI, see below).
- **`curated_models[].inventory_digest`** is computed with the **same
  algorithm as atomic-chat-core**, over **every file** in the Hugging Face
  repository at the pinned `revision` — not a filtered subset; an engine's
  own file-type selection happens later and is not part of a checkpoint's
  identity. The file list itself comes from the Hugging Face API endpoint
  `https://huggingface.co/api/models/<owner/name>/revision/<sha>?blobs=true&files_metadata=true`,
  read for **every file in the response, not only weights**: each file's path
  is its `rfilename`; its byte size is `lfs.size` when the file has an `lfs`
  block, else its plain `size`; its published hash is `lfs.sha256` when
  present, else an empty string (a non-LFS file has no published hash).
  Files are then sorted by path; for each file the digest folds in
  `${path.length}:${path}`, then `|${bytes}|`, then the published hash (or
  empty string), then a NUL byte; the result is `sha256:<hex of the running
  digest>`. `.github/scripts/inventory-digest.mjs` reproduces this from the
  live Hugging Face API (see below). Which consumer recomputes and compares
  this digest (atomic-chat-core, the app, or the CLI) is for the plan to
  name — that is not decided here.
- **`download_bytes` / `required_disk_bytes`** are estimated from the image's
  own registry manifests: `download_bytes` sums the compressed layer sizes
  (the larger of the two platforms); `required_disk_bytes` adds the
  estimated **extracted** size, measured by sampling each large layer's
  compression ratio (a capped-prefix `gzip -dc`) and weighting by layer size,
  rounded up to the next GiB.

### Reproducing runtime descriptor digests

`runtimes/tensorrt-llm.json` pins each image by its per-platform manifest
digest (not the multi-arch index digest), so `docker pull repo@digest` gets
exactly that platform. These print the digests from the registry (no Docker
daemon needed); they match the descriptor for as long as NVIDIA does not
repoint the tags:

```bash
docker buildx imagetools inspect nvcr.io/nvidia/tensorrt-llm/release:1.2.1
docker buildx imagetools inspect nvcr.io/nvidia/cuda:13.1.0-base-ubuntu24.04

# Same without Docker: anonymous registry token, then the manifest list.
for ref in nvidia/tensorrt-llm/release:1.2.1 nvidia/cuda:13.1.0-base-ubuntu24.04; do
  repo=${ref%:*} tag=${ref##*:}
  T=$(curl -s "https://nvcr.io/proxy_auth?scope=repository:$repo:pull" | jq -r .token)
  curl -s -H "Authorization: Bearer $T" \
    -H "Accept: application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json" \
    "https://nvcr.io/v2/$repo/manifests/$tag" |
    jq -r --arg ref "$ref" '.manifests[] | "\($ref) \(.platform.os)/\(.platform.architecture) \(.digest)"'
done
```

A curated model's `revision` is the commit `main` resolved to when it was
curated, and its `inventory_digest` is computed from the Hugging Face file
list at that commit with the same algorithm as atomic-chat-core:

```bash
curl -s https://huggingface.co/api/models/nvidia/Qwen3-8B-FP8/revision/main | jq -r .sha
node .github/scripts/inventory-digest.mjs nvidia/Qwen3-8B-FP8 2cebc4c89e25abc17668c81b01dceaf3d8b914d5
```

> **Note for whichever component recomputes this.** `inventory_digest` hashes
> **all** files at the pinned revision (`/revision/<sha>`), not a
> `.gguf`-filtered subset. Whichever consumer recomputes and compares it —
> atomic-chat-core, the app, or the CLI, to be named by the plan — must hash
> the full safetensors inventory at that revision the same way, or a curated
> entry's digest will never match.

## CI validation

[`.github/workflows/validate.yml`](.github/workflows/validate.yml) runs on
every push and pull request. It performs the following checks:

- `ajv` validates `providers/registry.json` against `providers/schema.json`.
- Every `provider` id must be unique.
- The job fails if any `api_key` field is non-empty.
- `ajv` validates `models/recommended.json` against `models/schema.json`.
- Every `(model_name, description_key)` pair in the recommended-models
  manifest must be unique.
- `ajv` validates `models/staff-picks.json` against
  `models/schema.staff-picks.json`.
- Every `model_name` and every `order` in the staff-picks manifest must be
  unique, and `description_key`, when present, must start with `hub:`.
- `ajv` validates `backends/manifest.json` against `backends/schema.json`.
- Every `llama-*` asset name must carry the declared `tag_name`, and asset
  names must be unique.
- `sha256` and `size` must appear together on an asset, and when
  `download_base` is set every `llama-*` asset must carry a `sha256` — an
  archive we host but do not hash would be downloaded unverified.
- `ajv` validates `backends/turboquant-manifest.json` against
  `backends/turboquant-schema.json`.
- Every TurboQuant `tag` must look like `b<build>-<semver>` and all entries must
  share one tag, every `asset` must be `llama-turboquant-<id>.zip` on Windows /
  `.tar.gz` elsewhere, and backend ids must be unique.
- `ajv` validates `runtimes/tensorrt-llm.json` against `runtimes/schema.json`.
- Cross-field integrity that the schema cannot express is checked by
  `node --test` over `.github/scripts/runtime-descriptor.test.mjs`,
  `.github/scripts/inventory-digest.test.mjs` and
  `.github/scripts/runtime-descriptor-integrity.test.mjs`: fixture
  accept/reject against the schema, and on the real descriptor —
  `supported_architectures` and `quantization[].format` are unique,
  every `model_families` key is a `supported_architectures` entry,
  `curated_models` are unique by `repository@revision`, `recipes[].recipe_id`
  is unique, `distributions` are unique by `(id, version_id, arch)` within a
  recipe, `descriptor_id` starts with `engine_id + "-"`,
  `required_disk_bytes >= download_bytes`, and `minimum_compute_capability`
  is at or below every `quantization[].min_compute_capability`.

You cannot merge a PR until CI is green.

## Local validation

`make validate` is the one command that runs every gate above, including all
the `node --test` scripts (fixtures, cross-field integrity, descriptor_id
immutability) — the same checks CI runs on a PR.

If you want to run the schema checks individually before pushing:

```bash
npx ajv-cli@5 validate -s providers/schema.json -d providers/registry.json --strict=false
npx ajv-cli@5 validate -s models/schema.json    -d models/recommended.json   --strict=false
npx ajv-cli@5 validate -s models/schema.staff-picks.json -d models/staff-picks.json --strict=false
npx ajv-cli@5 validate -s backends/schema.json  -d backends/manifest.json     --strict=false
npx ajv-cli@5 validate -s backends/turboquant-schema.json -d backends/turboquant-manifest.json --strict=false
npx ajv-cli@5 validate -s runtimes/schema.json -d runtimes/tensorrt-llm.json --strict=true
```

## Security

- API keys must never appear in this repository.
- The registry is served via HTTPS from `raw.githubusercontent.com`.
- Atomic Chat clients ignore the `api_key` field even if a malicious commit slips
  through; user-supplied keys live only in the local OS keychain.

## License

See the project's primary license in the main Atomic Chat repository.
