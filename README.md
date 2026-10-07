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
  decision.json      # Decision models (TurboQuant checkpoints and llama.cpp GGUFs)
  schema.decision.json # JSON Schema (Draft-07) for the decision catalog
  atomic-prism-models.json # Which Bonsai GGUF files need PrismML llama.cpp (atomic-prism)
  schema.atomic-prism-models.json # JSON Schema (Draft-07) for the Prism model rules
backends/
  manifest.json            # llama.cpp backend catalog (mirrors a ggml-org release)
  schema.json              # JSON Schema (Draft-07) for the backends manifest
  turboquant-manifest.json # TurboQuant backend catalog (one unified release tag)
  turboquant-schema.json   # JSON Schema (Draft-07) for the TurboQuant manifest
  atomic-prism-manifest.json # PrismML llama.cpp releases (candidate / approved per asset)
  atomic-prism-schema.json   # JSON Schema (Draft-07) for the PrismML manifest
  sdcpp-manifest.json      # stable-diffusion.cpp build catalog (read by core)
  sdcpp-schema.json        # JSON Schema (Draft-07) for the sd.cpp manifest
  mlx-manifest.json        # The pinned mlx-server build (read by core and the desktop Makefile)
  mlx-schema.json          # JSON Schema (Draft-07) for the MLX manifest
runtimes/
  tensorrt-llm.json  # TensorRT-LLM managed-engine runtime descriptor
  vllm.json          # vLLM managed-engine runtime descriptor (branch only until live acceptance)
  schema.json        # JSON Schema (Draft-07) for a runtime descriptor, shared by every engine
  environments/
    linux.json        # Linux environment manifest (where core may install Docker + the NVIDIA toolkit)
    linux.schema.json # JSON Schema (Draft-07) for the Linux environment manifest
    windows.json        # Windows environment manifest (the rootfs core imports as its own WSL2 distribution)
    windows.schema.json # JSON Schema (Draft-07) for the Windows environment manifest
    windows-arm64.json        # Windows on Arm environment manifest (an aarch64 rootfs; read only by an arm64 core)
    windows-arm64.schema.json # JSON Schema (Draft-07) for the Windows on Arm environment manifest

app/
  latest.json        # Installers the atomic.chat landing page links to
  schema.json        # JSON Schema (Draft-07) for the landing release manifest
.github/
  workflows/validate.yml        # Validates every manifest on every PR
  workflows/mirror-upstream.yml # Mirrors + signs an upstream llama.cpp release
  workflows/prism-release-watch.yml # Opens a PR listing a new PrismML release as candidate
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

## Decision models

`models/decision.json` lists the decision models of the Hub's Decision
category: models that answer typed questions (`choice`, `score`, `noul`) about
a state in one forward pass, served on `/v1/systemone`. The app downloads every
listed file into `<data>/decision/models/<id>/`, checking bytes and sha256, and
the core starts the decision server on the model's engine. One decision model
runs at a time.

A model runs on one of two engines, set by `engine`:

| `engine`            | `format`     | What the files are                                       | `min_engine`             |
| ------------------- | ------------ | -------------------------------------------------------- | ------------------------ |
| `llamacpp` (default)| `checkpoint` | A laya checkpoint folder TurboQuant converts to GGUF once | TurboQuant tag `b10269-1.7.0` |
| `llamacpp-upstream` | `gguf`       | One GGUF (`role: "model"`), plus an `mmproj` for vision  | Upstream tag, e.g. `b11370` |

The upstream builds that serve a type are: `b11370` for laya, openjev, lev, kev
and nimble; `b11371` for clef; `b11418` for clef with images. Until the
upstream manifest reaches a model's `min_engine`, the app lists the model with a
"needs llama.cpp b<N>+" notice instead of a Start button.

| Field           | Required            | Notes                                                                                       |
| --------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| `id`            | yes                 | Folder name under `decision/models` and the model id the engine answers with.               |
| `repo`, `revision` | yes              | Hugging Face repo and the full commit every file is pinned to.                              |
| `files`         | yes                 | `path`, `bytes`, `sha256` from the Hugging Face API; GGUF files also carry `role`.          |
| `engine`        | upstream only       | `llamacpp` or `llamacpp-upstream`. Also the settings page that manages the model.           |
| `format`        | upstream only       | `checkpoint` or `gguf`. An upstream model is always `gguf`.                                  |
| `decision_type` | upstream only       | The GGUF `<arch>.decision.type`: `laya`, `openjev`, `lev`, `kev`, `nimble`, `clef`.         |
| `icon`          | no                  | Bundled logo key (`web-app/src/lib/model-logo.ts`, `ICON_KEY_LOGOS`). Omitted: Convai.       |
| `vision`        | no                  | `true` for a model that reads images. It must list an `mmproj` file.                         |
| `default`       | no                  | The model suggested first on its engine's page. At most one per engine.                     |
| `context`       | yes                 | Prompt context the engine is started with (`-c`).                                            |

Clients that predate the `engine` field keep only checkpoint models: they drop
every model without the checkpoint files. So the catalog keeps
`schema_version: 1` and must always hold a default checkpoint model; the
integrity check enforces both. A new logo key needs the image in the app first,
then the `icon` value here.

## llama.cpp backends manifest

[`backends/manifest.json`](backends/manifest.json) is the catalog of
downloadable `llama.cpp` backend builds the Atomic Chat client offers on
**Windows, Linux (x64 and arm64) and Apple Silicon**. It exists to dodge GitHub's unauthenticated API
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
- Windows (x64 and arm64), Linux (x64 and arm64) and `macos-arm64` assets are
  listed. Linux arm64 is CPU, Vulkan and CUDA 13; the Snapdragon build is not
  mirrored. The Linux CUDA companion carries the tag in its name
  (`cudart-llama-<tag>-bin-ubuntu-cuda-<toolkit>-arm64.tar.gz`). macOS used to be
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

## MLX server manifest

[`backends/mlx-manifest.json`](backends/mlx-manifest.json) pins the one
`mlx-server` build Atomic Chat runs MLX models with on Apple Silicon: a
release of the `AtomicBot-ai/mlx-vlm` fork. Schema:
[`backends/mlx-schema.json`](backends/mlx-schema.json).

```json
{
  "$schema": "./mlx-schema.json",
  "upstream_repo": "AtomicBot-ai/mlx-vlm",
  "tag_name": "mlxvlm-macos-arm64-07ba5a1",
  "published_at": "2026-08-28T10:38:38Z",
  "assets": [
    {
      "backend": "macos-arm64",
      "name": "mlxvlm-mlx-server-macos-arm64.tar.gz",
      "sha256": "cce16896300c340da22e34ce007b2da081d2f9b8d156d8dd61bf7fc3700f9d88",
      "size": 210514030
    }
  ]
}
```

### Who reads it

- **Atomic Chat core** reads it from `main` (no pinned commit) to show the MLX
  build catalog, check for an MLX update and install one into
  `<data>/mlx/backends`. It keeps the last accepted copy on disk and answers
  from it when offline. `ATOMIC_MLX_MANIFEST_URL` (`https://` or `file://`)
  points core at another copy during development.
- **The desktop Makefile** (`make build-mlx-server` in `atomic-chat`) bundles
  the same build into the installer, checking `sha256` before unpacking, and
  writes `{tag, published_at}` next to the binary so core can compare the
  bundled build with downloaded ones. `MLX_MANIFEST=<file>` points it at a
  local copy.

Because core reads `main` directly, **merging a newer `published_at` offers
that build as an update to every running client** within about an hour.

### Fields

- `tag_name` — the fork's release tag, `mlxvlm-macos-arm64-<commit>`. The
  commit hash says nothing about order.
- `published_at` — the release's `publishedAt` on GitHub. This is the version
  order: clients treat a build as an update only when it was published
  strictly later than the active one, so rolling the manifest back to an older
  release never downgrades anyone.
- `assets` — exactly one archive, `backend: "macos-arm64"`. `sha256` and
  `size` are mandatory: the archive is downloaded straight from the fork's
  GitHub release, not mirrored here, so the pinned hash is the only check on
  what gets executed. `sha256` is the asset's GitHub `digest` without the
  `sha256:` prefix.

### The referenced release is never deleted or re-uploaded

The `AtomicBot-ai/mlx-vlm` release that `backends/mlx-manifest.json` on `main`
points at **must not be deleted, and its asset must not be re-uploaded**.
Deleting it breaks every MLX install and every desktop build (404); re-uploading
the archive changes its hash, so every install and build fails the `sha256`
check. To ship a different build, publish a new release and repoint the
manifest. Once `main` points elsewhere, the old release may go.

### How to update the MLX manifest

Take the new release from the fork and print the manifest fields:

```bash
gh release view mlxvlm-macos-arm64-07ba5a1 -R AtomicBot-ai/mlx-vlm --json tagName,publishedAt,assets --jq '{tag_name: .tagName, published_at: .publishedAt, assets: [.assets[] | {backend: "macos-arm64", name, sha256: (.digest | ltrimstr("sha256:")), size}]}'
```

Copy `tag_name`, `published_at` and `assets` into the manifest (keep
`$schema` and `upstream_repo`), run `make validate`, open a PR, and merge once
CI is green.

## Runtime descriptors (`runtimes/`)

A runtime descriptor tells atomic-chat-core which container image a
**managed engine** (TensorRT-LLM, vLLM) runs, pinned by digest, what host
it needs, and what that release supports. There is **one descriptor per
engine**, named after it: `runtimes/<engine_id>.json` (`tensorrt-llm.json`,
`vllm.json`), all validated by the one shared `runtimes/schema.json`. The file
name **is** the engine: a descriptor whose `engine_id` differs from its file
name fails `make validate` and CI, because core fetches
`runtimes/<engine_id>.json` for the engine it has an adapter for and refuses a
descriptor carrying another engine's id. CI and `make validate` discover every
`runtimes/*.json` except `schema.json`, so a new engine's descriptor is
checked without editing either. It carries **data only** — no
command, script or argv lives in it — and it describes **the engine alone**.
Where core may set up the foundation every engine runs on (which Linux
distributions it can install a GPU container runtime on) is environment data,
shared by all engines; it lives in the [environment
manifest](#environment-manifests-runtimesenvironments), not here. The schema
rejects a descriptor that carries environment install data, and so does core.

### Who reads this

No released atomic-chat-core reads `runtimes/`: core 0.7.0–0.7.4 and every
already-released Atomic Chat app and CLI never fetch or parse this directory,
so publishing or changing a document here has no effect on them. The
environment manifests require core **0.7.5** or later; the current descriptor
`tensorrt-llm-1.3.0rc29-r3` requires core **0.7.6** (its
`minimum_core_version`): 0.7.5 refuses its architecture names with an
underscore and cannot read mixed-precision checkpoints, so it keeps whatever
descriptor it accepted before.

Every released core up to 0.9.9 reads **only** `runtimes/tensorrt-llm.json`.
`runtimes/vllm.json` is read only by a core built with the `vllm` adapter
(the core release of change `add-vllm-runtime`), and such a core treats each
engine's descriptor on its own: a missing or invalid `vllm.json` makes vLLM
unavailable and leaves TensorRT-LLM as it was.

core fetches each engine's descriptor from this repository's `main` branch.
For development, the source of each engine can be overridden with
`ATOMIC_RUNTIME_DESCRIPTOR_URL_<ENGINE>` — the engine id upper-cased, `-`
replaced by `_` — set to a `file://` path or a URL:

```bash
ATOMIC_RUNTIME_DESCRIPTOR_URL_VLLM=file://$PWD/runtimes/vllm.json
ATOMIC_RUNTIME_DESCRIPTOR_URL_TENSORRT_LLM=file://$PWD/runtimes/tensorrt-llm.json
```

The older `ATOMIC_RUNTIME_DESCRIPTOR_URL` keeps overriding `tensorrt-llm` only.

### `vllm.json` reaches `main` only after live acceptance

Publishing `runtimes/vllm.json` on `main` **is** the switch that turns vLLM on:
a core with the `vllm` adapter shows the engine only once the file is there
(a 404 means "unavailable", with no release and no restart needed when it
appears). So the descriptor lives on the change branch and is merged into
`main` only after the live acceptance on Linux and Windows has passed, and
after the app release that ships vLLM is out. CI and README changes can reach
`main` earlier: they are safe for every released client. Until the file is
merged its `descriptor_id` is not published, so acceptance findings are
fixed in place on the branch; from the merge on, the immutability rule below
applies to it like to any other descriptor. Removing `vllm.json` from `main`
switches vLLM off for everyone without a release.

### `descriptor_id` is immutable

The content published under a given `descriptor_id` never changes. core
caches an accepted descriptor by this id and pins an installation to it, so
editing a published descriptor's fields in place would silently change what
an already-installed engine is compared against. Any change — the image, the
compute-capability/quantization/architecture matrices, `model_families`, the
curated model list, or the notices — ships under a **new** `descriptor_id`
instead of editing this one. Adding or removing a distribution is not a
descriptor change: it ships as a new `manifest_id` of the environment
manifest, and the `descriptor_id` stays as it is.

The id format is `<engine_id>-<engine tag>-r<N>` (CI checks the
`<engine_id>-` prefix): bump the engine tag when the underlying engine
release changes (`tensorrt-llm-1.2.1-r2` → `tensorrt-llm-1.3.0-r1`), or bump
`N` when the tag stays the same but a data-only field changes (a new curated
model, a corrected notice, …). Each descriptor file is compared with its own
version on `main`, so editing `vllm.json` under a `descriptor_id` already on
`main` fails CI exactly as it does for `tensorrt-llm.json`.
`tensorrt-llm-1.2.1-r2` is `r1` with its distribution list moved out to the
environment manifest; `r1` was never published to `main`, and installs set
up against it on development machines are removed and set up again. The same
holds for `r2`: `tensorrt-llm-1.3.0rc29-r1` replaced it before either reached
`main`, and an engine installed from `r2` is removed and set up again (there
is no update operation yet). `tensorrt-llm-1.3.0rc29-r2` is `rc29-r1` without
its two dense Nemotron-H checkpoints (`NVIDIA-Nemotron-3-Nano-4B-FP8` and
`-BF16`): in the Windows live acceptance (2026-10-02) `trtllm-serve` 1.3.0rc29
failed to load `Nemotron-3-Nano-4B-FP8` with `KeyError: '-'`. The image bundles
`transformers` 5.5.4, whose `NemotronHConfig` maps `hybrid_override_pattern`
through `{"M": "mamba", "E": "moe", "*": "attention"}` only, so any checkpoint
with dense MLP layers (`-`) fails before TensorRT-LLM's own model code, which
does handle `-`, is reached. Mamba/MoE checkpoints (`M`, `E`, `*`) and those
that already ship `layers_block_type` are not affected, so
`NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4` stays listed. The NemotronH
architectures stay listed; the dense checkpoints come back once an image's
`transformers` parses `-`.
`tensorrt-llm-1.3.0rc29-r3` is `rc29-r2` with `minimum_driver_version`
lowered from `615.65.02` to `615.0`, the start of the R615 branch. `615.65.02`
is the image's `CUDA_DRIVER_VERSION` label — the driver the CUDA 13.4.1 build
was made with, not a requirement: CUDA 13.4's release notes map the toolkit to
a driver *branch* (R615), and every R615 driver runs CUDA 13.4. The patch-level
floor blocked the first NVIDIA Windows on Arm machines (2026-10-06), whose
Windows driver 616 hands WSL the R615 libraries `615.41`.

### Installed engines stay pinned to their descriptor

An installation records the `descriptor_id` it was set up with and keeps
using it. Publishing a new descriptor here therefore only affects **new**
installs; an existing install is unaffected until the user removes the
engine and sets it up again, which picks up whatever descriptor is current
at that point.

### How to update the engine tag

The steps below are written for TensorRT-LLM; vLLM follows the same steps
with its own sources (the vLLM source at the image's `VLLM_BUILD_COMMIT`, see
[vLLM descriptor](#vllm-descriptor-vllmjson)).

1. Confirm the candidate tag is the latest non-rc release with the
   platform/hardware support you need — check NVIDIA's own release notes and
   hardware-support docs at that tag, not just the tag list. **Exception, by
   owner decision of 2026-10-02:** the `tensorrt-llm-1.3.0rc29-*` descriptors pin
   the pre-release `1.3.0rc29`, because the model families the Hub offers (Qwen3.5
   and later, Gemma 4, Nemotron 3.5) do not load on 1.2.1 and 1.3.0 had no
   final release yet. The next descriptor moves to the `1.3.0` final release
   once NVIDIA publishes it; it does not move to a later rc.
2. Get the **per-platform manifest digest** for both the engine image and the
   probe image (see [Reproducing runtime descriptor
   digests](#reproducing-runtime-descriptor-digests) below) — never a
   multi-arch index digest.
3. Re-derive `supported_architectures`, `quantization` (including every
   format's `excluded_compute_capabilities`), `model_families` and
   `minimum_compute_capability` from that tag's own source (its parser
   registries, its hardware-support matrix), rather than carrying over the
   previous descriptor's values. Re-derive `minimum_driver_version` as the
   first version of the driver branch that the probe image's own CUDA version
   needs (from its `NVIDIA_REQUIRE_CUDA` constraint and that CUDA Toolkit
   version's release notes, "CUDA Toolkit and Corresponding Driver Branch":
   CUDA 13.4 → R615 → `615.0`). The engine image's `CUDA_DRIVER_VERSION` label
   is the driver its CUDA build was made with, not a floor; since CUDA 13.4 the
   toolkit no longer bundles a driver.
4. Re-derive `curated_models`: re-check each repo is still ungated, re-resolve
   `revision` to the commit its `main` branch currently points at, and
   recompute `inventory_digest` (below).
5. Recompute `download_bytes` and `required_disk_bytes` from the new image's
   registry manifests (below).
6. Update `notices` if the image's license terms changed, and `exclusions` if
   the release's support gaps changed.
7. Assign a new `descriptor_id` (`<engine_id>-<new tag>-r1`).
8. Run `make validate` before opening a PR — it runs the schema and every
   integrity check below against what you just wrote.

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
- **`minimum_driver_version`** is the lowest NVIDIA display driver version
  the `image` and `probe_image` run on. Core checks it in the probe, before
  the user has consented to anything: a host below it gets
  `prerequisite-blocked` with both the required and the actual driver
  version, and no Docker install or image pull is offered (design D16). Core
  reads the host's driver version from `nvidia-smi
  --query-gpu=driver_version`, splits both that value and this field on
  `.`, parses each component as a base-10 integer, pads whichever of the two
  has fewer components with zeros, and compares them as integer tuples; the
  host is blocked iff its tuple is lower than this field's. On Windows core
  compares the version of the NVIDIA libraries Windows hands WSL
  (`/usr/lib/wsl/lib`, Linux numbering: Windows driver 616 → `615.41`), not
  the Windows driver number. The value itself is the first version of the
  driver branch the `probe_image`'s own CUDA version needs, read from that
  image's `NVIDIA_REQUIRE_CUDA` constraint and that CUDA Toolkit version's
  release notes ("CUDA Toolkit and Corresponding Driver Branch": CUDA 13.4 →
  R615 → `615.0`). It is **not** the engine image's `CUDA_DRIVER_VERSION`
  label: that is the driver its CUDA build was made with, and a patch-level
  floor from it blocks drivers of the same branch that run the image. This
  is the **non-datacenter (GeForce/consumer) floor**, since `NVIDIA_REQUIRE_CUDA`'s own brand exceptions only relax it
  for datacenter/vGPU brands. **This is deliberately stricter than some
  hosts need**: `probe_image`'s own `NVIDIA_REQUIRE_CUDA` carries
  CUDA-minor-version-compatibility exceptions that let specific
  datacenter/vGPU card brands (Tesla, Quadro, GRID, vGPU profiles, …) run on
  several driver branches older than this floor. `minimum_driver_version` is
  one number, not a brand-conditional table, so it also blocks those
  datacenter hosts on an older driver that forward compatibility would
  otherwise have let through — a deliberate simplification favoring one
  clear blocker message over modeling every brand exception. To update it
  for a new engine tag: read the new probe image's CUDA version
  (`NVIDIA_REQUIRE_CUDA`), find its driver branch in that CUDA Toolkit
  version's release notes, and write the branch's first version (`<branch>.0`).
- **`quantization[].excluded_compute_capabilities`** lists compute
  capabilities where this engine release does **not** support the format,
  even though the capability is numerically above the format's own
  `min_compute_capability` — because the engine's hardware support matrix is
  not monotone in compute capability (see the `quantization[].format`
  bullet below): a newer architecture can lack a format that an older one
  has. Together with `min_compute_capability`, this field fully encodes the
  tag's matrix for that format: a card is compatible with the format iff its
  compute capability is `>= min_compute_capability` **and not** in this
  list. The list is a **deny-list, not an allow-list**, so a compute
  capability the tag's matrix simply has no row for counts as supported once
  it clears the minimum — unless the controller has an independent reason to
  infer an exclusion anyway. `12.1` (sm121, NVIDIA DGX Spark) is one such
  case: TensorRT-LLM 1.2.1's release notes say it added sm121 support, but
  its hardware-support matrix has no sm121 row to read a verdict from, and
  sm121 is a consumer Blackwell part in the same family as sm120 (`12.0`) —
  so `w4a16_awq`, `w4a8_awq`, `fp8_block_scales` and
  `fp8_per_channel_per_token`, which all already deny sm120, also list
  `12.1` here even though the matrix never names it. Core's
  model-compatibility check treats a match here as `MODEL_INCOMPATIBLE` at
  check time, distinct from (and in addition to) the plain minimum-CC check
  (design D17). Empty when the matrix shows no such gap for that format. To
  update it for a new engine tag: re-read that tag's hardware support matrix
  and, for every format, list every row above its `min_compute_capability`
  where the matrix does not mark the format supported — the integrity check
  (below) then enforces that every entry here is strictly above that
  format's own minimum.
- **`curated_models[].vram_tier_bytes`** is the tier's nominal size in
  **decimal GB** (`× 10^9`), not binary GiB. Real cards report a little under
  their nominal binary size (an RTX 4090 reports 24,564 MiB; an H100 reports
  81,559 MiB) but still above the decimal-GB figure, so the decimal value
  works as a safe floor for "does this model fit the tier" without
  overshooting the VRAM any card in that tier actually has. On unified-memory
  systems (NVIDIA GB10 / DGX Spark) `nvidia-smi` reports no dedicated card
  memory at all, so there the tier is instead compared against the host's
  `MemAvailable` (design D13).
- **`quantization[].format` names** follow one fixed checkpoint-metadata →
  format-name rule, **shared by every engine** and documented here as the
  conf↔core contract (atomic-chat-core implements it once, for all managed
  engines). A name says **how the weights are encoded on disk**, not just
  their arithmetic: checkpoints that loaders read differently get different
  names even when the bit widths match (ModelOpt `w4a16_awq` ≠ AutoAWQ
  `autoawq_w4a16`; ModelOpt `fp8` ≠ Hugging Face `hf_fp8` ≠ block-scaled
  `fp8_block_scales`). The rule only **names** a checkpoint; whether an engine
  loads it is decided by that engine's descriptor: an engine loads a format
  iff its pinned descriptor has a `quantization` row with that name. A
  checkpoint the rule does **not recognize** is rejected by every engine as
  unsupported (naming its `quant_method` when there is one) — it never falls
  through to the unquantized step 4.

  The inputs are the checkpoint's `config.json` content, and — when the
  checkpoint carries the file — its `hf_quant_config.json` content: a
  checkpoint can have no `quantization_config` in `config.json` at all and
  still be quantized (e.g. `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8` and
  `nvidia/Llama-3.3-70B-Instruct-NVFP4` both classify entirely from
  `hf_quant_config.json`), so `dtype`/`torch_dtype` must never be trusted
  before `hf_quant_config.json` has been checked. `quant_method` and the
  string values below are compared lower-cased. Apply these steps in order,
  stopping at the first that matches:
  1. If `hf_quant_config.json` is present (NVIDIA ModelOpt), the format is its
     `quantization.quant_algo` lower-cased, with `fp8_pb_wo` renamed to
     `fp8_block_scales` (matching what TensorRT-LLM itself calls it
     internally). ModelOpt names therefore include `fp8`,
     `fp8_per_channel_per_token`, `fp8_block_scales`, `nvfp4`, `w4a16_nvfp4`,
     `mxfp8`, `w4a16_awq` and `w4a8_awq`.
  2. Otherwise, if `config.json`'s `quantization_config.quant_method` is set:
     - `modelopt` → the format is `quantization_config.quant_algo`
       lower-cased, with the same `fp8_pb_wo` → `fp8_block_scales` rename as
       step 1.
     - `fp8` **with** `quantization_config.weight_block_size` equal to
       `[128,128]` → `fp8_block_scales`.
     - `fp8` **without** `weight_block_size` (absent or `null`) → `hf_fp8`:
       the Hugging Face / AutoFP8 encoding with per-tensor or per-channel
       scales. `fp8` with any other block size is **not recognized**.
     - `mxfp4` → `mxfp4`.
     - `awq` (AutoAWQ) with `bits` (or `w_bit`) equal to 4 and `version`
       absent or `gemm` → `autoawq_w4a16`. Any other bit width, or another
       packing `version` (`gemv`, `gemv_fast`, `exllama`, `marlin`, …), is
       **not recognized**: the packed bytes on disk differ.
     - `gptq` with `bits` 4 or 8, `sym: true`, and `checkpoint_format` absent
       or `gptq` → `gptq_w4a16` or `gptq_w8a16`. Other bit widths, asymmetric
       quantization (`sym: false`) and other checkpoint formats (`gptq_v2`,
       `marlin`) are **not recognized**.
     - `compressed-tensors` → named by its scheme (below).
     - `bitsandbytes` is deliberately **not recognized**: engines load it
       slowly and only partially, so it is not offered at all.
     - anything else is **not recognized**.
  3. Otherwise, if `config.json` has a top-level `quantization` object (the
     MLX convention: `bits`, `group_size`, e.g.
     `prism-ml/Bonsai-27B-mlx-1bit`), the checkpoint is **not recognized**:
     its weights are MLX-packed while its `dtype` still names the
     unquantized model, so it must not fall through to step 4 and be
     reported as `bf16`/`fp16`.
  4. Otherwise the checkpoint is unquantized: read `dtype` — the field
     TensorRT-LLM itself reads (`model_config.py:471`) — falling back to the
     legacy `torch_dtype` key only when `dtype` is absent, and then to
     `text_config.dtype` / `text_config.torch_dtype` (a VLM-style config such
     as Qwen3.5's declares its dtype only there, and TensorRT-LLM 1.3 falls
     back the same way). `bfloat16` → `bf16`; `float16` → `fp16`; anything
     else, including `float32` or a missing/unrecognized value, is **not
     recognized**.

  A **compressed-tensors** checkpoint (llm-compressor) is named by its
  `quantization_config.config_groups`. Each group is classified by its
  `weights` (`type`, `num_bits`) and `input_activations` (absent or `null`
  means weight-only):

  | `weights` | `input_activations` | format |
  | --- | --- | --- |
  | `int`, 4 bits | none | `ct_w4a16` |
  | `int`, 8 bits | none | `ct_w8a16` |
  | `float`, 8 bits | `float`, 8 bits | `ct_w8a8_fp8` |
  | `int`, 8 bits | `int`, 8 bits | `ct_w8a8_int8` |
  | `float`, 4 bits, `group_size` 16 | `float`, 4 bits | `ct_nvfp4` |

  Every group must give the same name, and that name is the format. A group
  that matches no row, groups that give different names, no groups at all,
  or a `sparsity_config` whose `format` is anything but `dense` (an empty
  `{}` or `null` means no sparsity) make the checkpoint **not recognized**.

  **The rule never changes a TensorRT-LLM verdict.** Every name added for
  vLLM (`hf_fp8`, `autoawq_w4a16`, `gptq_w4a16`, `gptq_w8a16`, the five
  `ct_*` names) names a checkpoint that the rule used to call "not
  loadable", and no `tensorrt-llm` descriptor has a row for any of them — so
  for every checkpoint, every published TensorRT-LLM descriptor gives the
  same `ok` or `MODEL_INCOMPATIBLE` as before; only the reason text can
  change (it now names the format). atomic-chat-core proves this with a
  verdict test over its TensorRT-LLM checkpoint corpus. Already-released
  cores are unaffected: they read only `tensorrt-llm.json`, which carries
  none of the new names. The same constraint binds every future edit: a new
  name may only be given to a checkpoint the rule did not recognize before;
  renaming or reclassifying a checkpoint that already has a name changes the
  verdict of published descriptors and is not allowed.

  A format of `mixed_precision` (ModelOpt `quant_algo: MIXED_PRECISION`, e.g.
  `nvidia/Qwen3.8-27B-NVFP4`) is never a row of its own. Its
  `hf_quant_config.json` lists a `quant_algo` per layer in
  `quantization.quantized_layers`; each distinct per-layer value is named by
  step 1's rule (`FP8` → `fp8`, `NVFP4` → `nvfp4`, `W4A16_NVFP4` →
  `w4a16_nvfp4`, …), every one of those names must have a `quantization` row,
  and a card must clear all of them: the highest `min_compute_capability`
  and every listed exclusion. A mixed checkpoint whose layers name a format
  without a row, or that names none, is not loadable.

  `w4a16_nvfp4` has no row in NVIDIA's hardware-support matrix at
  `1.3.0rc29`; its row copies `nvfp4` (10.0, no exclusions) as the
  conservative choice, although the engine also has a Marlin path for it on
  8.9–9.x and 12.x that nobody has run here yet.

  Each format also carries exactly one `min_compute_capability` and its own
  `excluded_compute_capabilities` (above) — together the two fields are the
  **complete** compatibility rule for that format, not merely a conservative
  floor: the engine's real hardware-support matrix is not monotone in
  compute capability (a format can be marked supported on a newer
  architecture while unlisted on one immediately below it), and
  `excluded_compute_capabilities` is exactly the set of gaps that
  `min_compute_capability` alone would miss. Core's check rejects an
  incompatible checkpoint for either reason at check time, so no format's
  matrix gap can let a checkpoint through to a load that then fails on that
  specific card. The descriptor's overall `minimum_compute_capability` is
  always a lower bound on every format's own minimum (enforced by CI, see
  below).
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

### Status of `tensorrt-llm-1.3.0rc29-r1`

**Not live-qualified.** Every value comes from the image's registry manifests,
the TensorRT-LLM source at tag `v1.3.0rc29` and the Hugging Face API on
2026-10-02, and core's own algorithm reproduces every curated
`inventory_digest`; nothing has run on a card yet. What changed from
`tensorrt-llm-1.2.1-r2`:

- **Driver:** the image is CUDA 13.4 (`CUDA_DRIVER_VERSION` label 615.65.02),
  and CUDA 13.4 needs the R615 branch on consumer cards, so
  `minimum_driver_version` is `615.0` (since `rc29-r3`; `r1` and `r2` carried
  the label's `615.65.02`). Hosts on R580–R610 are blocked at the probe until
  they update the driver.
- **Architectures:** re-derived from `_arch_index.py`. The vision-language
  architectures whose text path serves chat are listed for the families the
  curated list carries (Qwen3.5/3.6/3.8, Gemma 4, Gemma 3, Mistral 3,
  Qwen4Exp); they run text-only. `NemotronNASForCausalLM` is gone (it was a
  class name, never a registered key; `DeciLMForCausalLM` is the key), and
  `DeepseekV4ForCausalLM` is left out because it needs sm100+ and the
  descriptor has no per-architecture capability.
- **Curated models:** a new list of 15 across the 8–80 GB tiers, including
  three mixed-precision NVIDIA checkpoints. Mistral and gpt-oss repositories
  ship a second copy of their weights and are left out, since the client
  downloads every file of a curated repository.
- **Telemetry:** `trtllm-serve` 1.3 reports anonymous usage to NVIDIA by
  default; core 0.7.6 turns it off with `TRTLLM_NO_USAGE_STATS=1`.

### Live qualification of `tensorrt-llm-1.2.1-r1`

`tensorrt-llm-1.2.1-r1` was checked against atomic-chat-core's live tests on
2026-09-29, and nothing in it changed as a result. The rule: a curated model
leaves the list only if it actually failed on a card it fits, a distribution
or architecture leaves the install list only if it failed the install test,
and `required_disk_bytes` changes only if measured post-pull usage differs by
more than 10%. None of these happened. The results carry over unchanged:
`tensorrt-llm-1.2.1-r2` has the same image, models and sizes, and the
environment manifest `linux-r1` has the same distribution list.

- **Install (core task 2.18, `test/live/managed-install.test.ts`)** —
  clean VMs with an RTX 4070 Laptop (CC 8.9) passed through. All seven x86_64
  versions passed: Ubuntu 22.04, 24.04, 26.04; Debian 12, 13; Fedora 43, 44
  (with SELinux enforcing). Hosts that already ran Docker were covered on
  Ubuntu 24.04 and Fedora 44 (restart only after consent), and Fedora 44 with
  `moby-engine` got a toolkit-only plan. The Arch adopt path was not run.
  Ubuntu 26.04 needed five runs: earlier runs failed on
  `nvcr.io` 403s and once on `docker.service` start, then every step passed.
  **aarch64 was not tested** (no arm64 host with an NVIDIA card); its entries
  stay because nothing failed, not because they passed.
- **Engine (core task 2.19, `test/live/tensorrt-llm.test.ts`)** — one card
  only (Ada, 8 GB): `Qwen/Qwen3-1.7B` at the pinned revision loaded, streamed,
  reloaded faster from the engine cache, made a tool call through the `qwen3`
  parser and returned structured output (8 passed, 2 skipped). The other ten
  curated entries, FP8 and NVFP4, and Ampere/Hopper/Blackwell/GB10 cards were
  not run; they stay in the list because none of them failed.
- **Sizes** — the pulled engine image was 20.88–20.90 GB on every VM, within
  1.2% of `download_bytes` (the difference is the probe image and layers
  already present). Disk space actually used after the pull was **not
  measured**, so `required_disk_bytes` keeps its estimate.

The logs live in atomic-chat-core's checkout of branch
`change/add-tensorrt-llm-linux`, under `.superpowers/sdd/tasks/live-results/`
(`vm-campaign/*`, `managed-install-ubuntu-26.04-x86_64-run*.log`,
`tensorrt-llm-run2.log`).

### vLLM descriptor (`vllm.json`)

`vllm-0.31.0-r1` pins the vLLM project's own image
`docker.io/vllm/vllm-openai:v0.31.0` (build commit
`db9527a46873454610df6dbedf79a36d6bf1a7f6`, the `v0.31.0` tag) for
`linux/amd64` and `linux/arm64`, and the CUDA 13.0 base image
`nvcr.io/nvidia/cuda:13.0.2-base-ubuntu24.04` for the GPU check. **Not
live-qualified yet**: every value below comes from the registry manifests,
the vLLM source at that commit and the Hugging Face API on 2026-10-06. The
live acceptance on an RTX 4070 Laptop (compute capability 8.9, 8 GB) under
Ubuntu and Windows, run by the maintainers of change `add-vllm-runtime`
with atomic-chat-core's live tests, confirms or corrects the driver floor,
the matrix rows that run on 8.9, the curated list and the memory overheads
before the file reaches `main`; its findings are recorded in that change's
`rulings/`.

- **Why not the `-cu129` variant.** The first descriptor,
  `vllm-0.31.0-cu129-r1`, pinned `v0.31.0-cu129` for its lower driver floor
  (R575). That image cannot start: next to `torch 2.13.0+cu129` it ships
  `torchcodec 0.17.0`, built for CUDA 13, whose `libtorchcodec_image.so` needs
  `libnvrtc.so.13`; the image has only `libnvrtc.so.12`. The `vllm` command
  imports `torchcodec` on start and does not catch that `OSError`, so every
  model fails with "vLLM exited with code 1 before it was ready" (Windows
  acceptance, 2026-10-06; a bare `python3 -c "import torchcodec"` in the image
  fails the same way, without a GPU or any of core's flags). vLLM requires
  `torchcodec >= 0.14` with no upper bound, so the `-cu129` build picks up
  whatever CUDA 13 wheel is current. The default tag is CUDA 13.0 throughout.
  `vllm-0.31.0-cu129-r1` never reached `main`; an engine installed from it on
  a development machine is removed and set up again. The cost is the driver
  floor: R580 instead of R575, still well below TensorRT-LLM's R615, which is
  what keeps it off many desktops and why vLLM is added. NGC's
  `nvcr.io/nvidia/vllm` is not used: newer CUDA (higher floor), later than
  upstream, and NGC terms on top.
- **`minimum_driver_version` `580.0`.** The image's `NVIDIA_REQUIRE_CUDA` is
  `cuda>=13.0` (`CUDA_VERSION` 13.0.2), and CUDA 13.0 needs the R580 branch on
  consumer cards, so the floor is that branch's first version, by the same
  rule as TensorRT-LLM (see `minimum_driver_version` above). The image's
  datacenter brand exceptions (535, 550, 565, 570 and 575 branches) are not
  modelled. The probe image is CUDA 13.0 as well, so the GPU check does not
  raise the floor.
- **`minimum_compute_capability` `8.0`** (Ampere), the same as
  TensorRT-LLM. The amd64 image also carries Turing (7.5) kernels, but no
  Turing card is available to check it, and a floor is not lowered without a
  live run.
- **`quantization`.** vLLM's documented hardware table stops at Hopper and
  has no rows for NVFP4, MXFP4 or ModelOpt, so the matrix is read from the
  code instead: each quantization method's `get_min_capability()` at the
  build commit, the gate vLLM itself applies at load. Every format the shared
  rule recognizes and vLLM loads has a gate at or below 8.0 — where a card
  lacks native FP8 or FP4 tensor cores, vLLM falls back to Marlin
  weight-only kernels (FP8, NVFP4, MXFP4) or, for compressed-tensors FP8, to
  W8A16 — so every row is `8.0` with no exclusions. Not listed: ModelOpt
  `w4a16_awq` and `w4a8_awq` (vLLM's ModelOpt loader does not accept them),
  GPTQ other than 4/8-bit symmetric and AutoAWQ other than 4-bit (vLLM 0.31
  refuses them), and bitsandbytes and GGUF. **Only the rows that run on 8.9
  are checked live** (by the acceptance above). The rows that need native
  support on newer cards to run fast — FP8 with block scales on Hopper,
  NVFP4 and MXFP4 on Blackwell — and every row on 8.0/8.6, 9.0, 10.x and 12.x
  come from the code alone. A row that turns out wrong fails at load with
  the engine's own error and logs, and is fixed by a new `descriptor_id`
  without a core release.
- **`supported_architectures`.** Every architecture of the TensorRT-LLM
  descriptor, all of which vLLM 0.31 serves (HunYuan, Starcoder2 and EXAONE
  MoE through its Transformers backend; EXAONE MoE under vLLM's and Hugging
  Face's spelling `ExaoneMoeForCausalLM`), plus six text families common on
  small cards that TensorRT-LLM lacks: `Gemma2ForCausalLM`,
  `GraniteForCausalLM`, `GraniteMoeHybridForCausalLM` (Granite 4),
  `Ernie4_5ForCausalLM`, `Ernie4_5_MoeForCausalLM` and `Lfm2ForCausalLM`.
  Vision-language classes run text-only.
- **`model_families`.** Parser names are vLLM's own registry names at the
  build commit (`vllm/tool_parsers/__init__.py`, `vllm/reasoning/__init__.py`),
  chosen per family from vLLM's tool-calling and reasoning docs and the model
  cards' `vllm serve` flags. A family gets a parser only when it works with
  the checkpoint's own chat template: the adapter passes no
  `--chat-template`, so families whose vLLM recipe requires one (Llama 3.x,
  DeepSeek V3/V3.1, Mistral in the Transformers format, Granite 3.0) have
  none, and so do families with more than one reasoning mode where a wrong
  reasoning parser would swallow the answer (EXAONE, Trinity, ERNIE). Cohere
  Command's parsers need the `cohere_melody` package, which only vLLM's test
  requirements install, not the image. These names differ from TensorRT-LLM's for the same family
  (Qwen3: `hermes`, not `qwen3`; Qwen3.5: `qwen3_coder` and `qwen3`, not
  `qwen3` and `qwen3_5`) — the descriptor of each engine names its own
  registry.
- **`curated_models`.** First the thirteen TensorRT-LLM models at the same
  revisions, so one copy on disk serves both engines (their tiers are those
  of TensorRT-LLM, except `Qwen3.6-35B-A3B-FP8`, which vLLM also runs below
  Hopper and so drops to the 48 GB tier); then 4-bit checkpoints that
  TensorRT-LLM cannot load, for 8 and 12 GB cards: `Qwen/Qwen3-4B-AWQ`
  (AutoAWQ), `cyankiwi/Qwen3.5-4B-AWQ-4bit` (compressed-tensors W4A16, a
  community quantization: Qwen publishes no 4-bit Qwen3.5 below 27B) and
  `Qwen/Qwen3-8B-AWQ`. Google's own `gemma-4-*-qat-w4a16-ct` checkpoints are
  left out: their unquantized embeddings and encoders keep even E2B at
  8.3 GB.
- **`download_bytes`** is the larger platform's compressed layers (arm64,
  10.1 GB); **`required_disk_bytes`** adds the extracted size sampled the
  same way as for TensorRT-LLM, 28 GiB.
- **Privacy.** core starts the container with vLLM's usage statistics off
  (`VLLM_NO_USAGE_STATS=1`, `DO_NOT_TRACK=1`) and Hugging Face offline: the
  image itself reports usage to `stats.vllm.ai` by default
  (`VLLM_USAGE_SOURCE=production-docker-image`).
- **`minimum_core_version` `0.9.9`, `minimum_app_version` `2.2.0`** are
  provisional: `0.9.9` is the version core's change branch starts from, so
  a development core accepts the file through
  `ATOMIC_RUNTIME_DESCRIPTOR_URL_VLLM`; both are set to the actual core and
  app releases that ship vLLM before the file is merged into `main`.

### Reproducing runtime descriptor digests

Every descriptor pins each image by its per-platform manifest digest (not
the multi-arch index digest), so `docker pull repo@digest` gets exactly that
platform. These print the digests from the registry (no Docker
daemon needed); they match the descriptor for as long as NVIDIA does not
repoint the tags:

```bash
docker buildx imagetools inspect nvcr.io/nvidia/tensorrt-llm/release:1.3.0rc29
docker buildx imagetools inspect nvcr.io/nvidia/cuda:13.4.1-base-ubuntu24.04
docker buildx imagetools inspect docker.io/vllm/vllm-openai:v0.31.0
docker buildx imagetools inspect nvcr.io/nvidia/cuda:13.0.2-base-ubuntu24.04

# Same without Docker: anonymous registry token, then the manifest list.
for ref in nvidia/tensorrt-llm/release:1.3.0rc29 nvidia/cuda:13.4.1-base-ubuntu24.04 nvidia/cuda:13.0.2-base-ubuntu24.04; do
  repo=${ref%:*} tag=${ref##*:}
  T=$(curl -s "https://nvcr.io/proxy_auth?scope=repository:$repo:pull" | jq -r .token)
  curl -s -H "Authorization: Bearer $T" \
    -H "Accept: application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json" \
    "https://nvcr.io/v2/$repo/manifests/$tag" |
    jq -r --arg ref "$ref" '.manifests[] | "\($ref) \(.platform.os)/\(.platform.architecture) \(.digest)"'
done

# Docker Hub (vLLM): the token comes from auth.docker.io.
T=$(curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:vllm/vllm-openai:pull" | jq -r .token)
curl -s -H "Authorization: Bearer $T" \
  -H "Accept: application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json" \
  https://registry-1.docker.io/v2/vllm/vllm-openai/manifests/v0.31.0 |
  jq -r '.manifests[] | "\(.platform.os)/\(.platform.architecture) \(.digest)"'
```

A curated model's `revision` is the commit `main` resolved to when it was
curated, and its `inventory_digest` is computed from the Hugging Face file
list at that commit with the same algorithm as atomic-chat-core:

```bash
curl -s https://huggingface.co/api/models/nvidia/Qwen3.8-27B-NVFP4/revision/main | jq -r .sha
node .github/scripts/inventory-digest.mjs nvidia/Qwen3.8-27B-NVFP4 482ca0f3832238542f8f5295dde86b5f22711d80
```

> **Note for whichever component recomputes this.** `inventory_digest` hashes
> **all** files at the pinned revision (`/revision/<sha>`), not a
> `.gguf`-filtered subset. Whichever consumer recomputes and compares it —
> atomic-chat-core, the app, or the CLI, to be named by the plan — must hash
> the full safetensors inventory at that revision the same way, or a curated
> entry's digest will never match.

## Environment manifests (`runtimes/environments/`)

An environment manifest describes the **foundation** every managed engine
runs on, apart from any one engine. There is one per platform:

- `runtimes/environments/linux.json` (schema `linux.schema.json`) — on which
  distributions atomic-chat-core may itself install a GPU container runtime
  (Docker CE + the NVIDIA Container Toolkit).
- `runtimes/environments/windows.json` (schema `windows.schema.json`) — the
  Ubuntu rootfs core imports as Atomic Chat's own WSL2 distribution, and the
  recipe that prepares it; see [Windows manifest](#windows-manifest-windowsjson).

Like a descriptor a manifest carries **data only** and has no `$schema` key.
In `linux.json` a `recipes[]` entry is a `recipe_id` naming argv that is
compiled into core (`linux.install-container-runtime`) plus the distributions
`{ id, version_id, arch }` that recipe is qualified to run on. No command,
script or argv lives here.

Linux core reads its manifest only to decide whether it can **offer to
install** Docker and the toolkit on this host. A host where Docker with GPU access already works
for the current user is accepted on any distribution, with or without a
manifest; if no manifest can be fetched or found in core's cache, only the
automatic install is blocked.

### One file per platform

Each platform has its own manifest file and its own schema (`linux.json`,
`windows.json`). core's parsers are strict — an unknown key rejects the
whole document — so a shared file with a section per platform would turn
adding a `windows` section into a document every already-released Linux core
refuses; a new Linux user without a cached copy would then lose automatic
install until they updated core. With a file per platform, Linux core reads
only `linux.json`, Windows core only `windows.json`, and work on one platform
never touches the other's document.

### `manifest_id` is immutable

The content published under a given `manifest_id` never changes, for the same
reason as `descriptor_id`: core caches an accepted manifest by this id, and an
operation the user consented to keeps using the manifest it was planned with
until it finishes, even if a newer one is published meanwhile. Any change —
including adding a single distribution — ships under a **new** `manifest_id`
of the form `<platform>-r<N>` (`linux-r1` → `linux-r2`, `windows-r1` →
`windows-r2`). CI compares every manifest under `runtimes/environments/`
against `main` and fails when the content changed under an id that is
already there.

### How to add a distribution

1. Confirm **both** vendors publish packages for that distro/version/arch:
   Docker CE (`download.docker.com`) and the NVIDIA Container Toolkit
   (`nvidia.github.io/libnvidia-container`). One vendor publishing alone does
   not qualify it.
2. Only add the entry once core's live install test has actually passed on
   that distribution — package availability is a precondition, not proof the
   recipe works there.
3. Append the `{ "id", "version_id", "arch" }` entry to the relevant
   `recipes[].distributions` in `runtimes/environments/linux.json`.
4. Bump the `manifest_id` (`linux-r<N>` → `linux-r<N+1>`). Do not touch the
   engine descriptor: its `descriptor_id` stays the same.
5. `make validate`, commit, open a PR.

### Windows manifest (`windows.json`)

On Windows, TensorRT-LLM runs in a Linux environment inside WSL2: Atomic
Chat's **own** distribution, which core imports from a pinned Ubuntu rootfs
as the signed-in user, and then prepares with the same recipe Linux hosts use
— run as root inside the guest, without Windows elevation. The manifest says
what to import and which recipe prepares it:

| Field | Meaning |
| --- | --- |
| `manifest_id` | `windows-r<N>`, immutable (see above). An imported environment stays pinned to the id it was imported from. |
| `platform` | Always `windows`. |
| `minimum_core_version` | Lowest core that understands this manifest. |
| `minimum_windows_build` | Lowest Windows build (third part of the OS version) core offers the environment on. `22000` = the first Windows 11 build; Windows 10 is not supported. |
| `minimum_wsl_version` | Lowest WSL package version, `MAJOR.MINOR.PATCH` as `wsl --version` prints it without the trailing build part. `2.4.4` is the first WSL that handles the `.wsl` rootfs format. |
| `rootfs.url` | HTTPS URL of the rootfs image; `http://` is rejected by the schema. |
| `rootfs.sha256` | Lowercase hex SHA-256 of that file. Core checks it before the file is used for anything. |
| `rootfs.distribution` | What the rootfs is, `{ id, version_id, arch }` in os-release terms; `arch` is `x86_64` in `windows.json`; Windows on Arm has its own file, below. |
| `guest_recipe_id` | Recipe compiled into core that prepares the guest after import (`linux.install-container-runtime`). Never a command. |

**Where the rootfs comes from.** Canonical's official WSL image of Ubuntu
24.04 LTS, published next to the ISOs on `releases.ubuntu.com`
(`https://releases.ubuntu.com/<point release>/ubuntu-<point release>-wsl-amd64.wsl`).
Its hash is listed in the `SHA256SUMS` file of the same directory, which is
signed by the Ubuntu CD Image signing key (`SHA256SUMS.gpg`, key
`843938DF228D22F7B3742BC0D94AA3F0EFE21092`).

**How to update the rootfs** (a new Ubuntu point release, or the URL stopped
resolving):

1. Download `SHA256SUMS` and `SHA256SUMS.gpg` from the release directory and
   verify the signature with the key above
   (`gpg --verify SHA256SUMS.gpg SHA256SUMS`). Take the `*-wsl-amd64.wsl` line.
2. Download the `.wsl` file itself and check that `shasum -a 256` matches
   that line — the manifest must never carry a hash nobody has reproduced.
3. Put the new `url` and `sha256` (and `version_id`, if the Ubuntu release
   changed) into `windows.json` and bump `manifest_id`
   (`windows-r<N>` → `windows-r<N+1>`). A new Ubuntu release (not a point
   release) also needs the guest recipe qualified on it in core first.
4. `make validate`, commit, open a PR.

Only new imports use the new manifest: an existing distribution stays on
the `manifest_id` it was imported from.

### Windows on Arm manifest (`windows-arm64.json`)

The same shape as `windows.json`, schema `windows-arm64.schema.json`:
`manifest_id` is `windows-arm64-r<N>` and `rootfs.distribution.arch` is
`aarch64` (Ubuntu's arm64 `.wsl` image, published on `cdimage.ubuntu.com`).
An arm64 Windows core (atomic-chat-core 0.9.2 and later, branch
`fix/tensorrt-llm-windows-arm64`) reads this file and an x64 core reads
`windows.json`. It is a separate file, not a second rootfs in `windows.json`,
because every released core parses `windows.json` strictly: an unknown or
`aarch64` field there would refuse the whole manifest and hide TensorRT-LLM
from every x64 user. Its rules are `windows.json`'s: a new rootfs is a new
`manifest_id`, the sha256 is checked against Ubuntu's signed `SHA256SUMS`,
and it reaches `main` only after live acceptance on a Windows on Arm machine
with an NVIDIA GPU (RTX Spark N1X).

**`windows.json` reaches `main` only after live acceptance on Windows.**
Merging it into `main` is what switches TensorRT-LLM on for every Windows
client within an hour, with no release: without it, core on Windows reports
the provider as unsupported to everyone who has not imported the
distribution yet, so app and core can ship their Windows code safely ahead of
it. The manifest is therefore merged only after the Windows acceptance run on
real hardware (Windows 11 x64 with an NVIDIA GPU: enabling WSL with UAC and a
reboot, importing the rootfs, Docker and the toolkit in the guest, a model
load and chat, localhost forwarding, removing the environment) has passed.
Rolling back is removing `windows.json` from `main`: new installs stop being
offered, already-imported environments keep working on their pinned manifest.

## Landing release manifest

[`app/latest.json`](app/latest.json) is read by the atomic.chat landing page
(Webflow) on every page load: a site-wide script swaps the page's installer
links for the ones listed here. It is not read by the desktop client — the
in-app updater keeps using the `latest.json` asset of the GitHub release.

```json
{
  "$schema": "./schema.json",
  "schema_version": 1,
  "updated_at": "2026-10-02T13:00:00Z",
  "version": "2.1.2",
  "tag": "v2.1.2",
  "release_url": "https://github.com/AtomicBot-ai/Atomic-Chat/releases/tag/v2.1.2",
  "downloads": {
    "macos": "https://github.com/AtomicBot-ai/Atomic-Chat/releases/download/v2.1.2/Atomic.Chat_2.1.2_universal.dmg",
    "windows": "https://github.com/AtomicBot-ai/Atomic-Chat/releases/download/v2.1.2/Atomic.Chat_2.1.2_x64-setup.exe",
    "linux": "https://github.com/AtomicBot-ai/Atomic-Chat/releases/download/v2.1.2/Atomic.Chat_2.1.2_amd64.AppImage"
  }
}
```

Do not edit it by hand. `make release-prod` in the Atomic-Chat repository
publishes the newest draft release, then commits this file straight to `main`
with the URLs of that release's installers. `raw.githubusercontent.com` caches
it for about five minutes, so the landing page follows a release within that.

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
- `ajv` validates `models/decision.json` against `models/schema.decision.json`
  (an upstream model must be `gguf`, name a `decision_type` and pin a `b<build>`
  tag; a checkpoint model a TurboQuant tag).
- `.github/scripts/decision-catalog-check.mjs`: model ids and file paths are
  unique and safe, a checkpoint model lists the four checkpoint files, a GGUF
  model has one `role: "model"` file and at most one `mmproj` (only when
  `vision` is true), at most one default per engine, and a default checkpoint
  model exists.
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
- Engine descriptors are **discovered, not named**: every `runtimes/*.json`
  except `schema.json` (`.github/scripts/runtime-descriptor-files.mjs`) goes
  through the checks below, so a new engine's descriptor is gated without
  editing the workflow or the Makefile.
- `node --test .github/scripts/runtime-descriptor.test.mjs` runs `ajv
  --strict` with `runtimes/schema.json` on every descriptor and on the
  accept/reject fixtures.
- `ajv` validates `backends/sdcpp-manifest.json` (and
  `backends/sdcpp-manifest.staging.json`, when present) against
  `backends/sdcpp-schema.json`, and `.github/scripts/sdcpp-manifest-check.mjs`
  checks, for both, the tag, unique backend ids and asset names, the required backends,
  the CUDA runtime companion, and `sha256`/`size` pairing.
- `ajv` validates `backends/mlx-manifest.json` against
  `backends/mlx-schema.json`, and `node --test` over
  `.github/scripts/mlx-manifest.test.mjs` checks the tag pattern, exactly one
  `macos-arm64` asset with `sha256` and `size`, and an RFC 3339
  `published_at` (ajv ignores `format` here), plus that broken copies fail
  the schema.
- Cross-field integrity that the schema cannot express is checked by
  `node --test` over `.github/scripts/inventory-digest.test.mjs` and
  `.github/scripts/runtime-descriptor-integrity.test.mjs`, on every
  descriptor — `engine_id` equals the file name,
  `supported_architectures` and `quantization[].format` are unique,
  every `model_families` key is a `supported_architectures` entry,
  `curated_models` are unique by `repository@revision`,
  `descriptor_id` starts with `engine_id + "-"`,
  `required_disk_bytes >= download_bytes`, `minimum_compute_capability`
  is at or below every `quantization[].min_compute_capability`, and every
  `quantization[].excluded_compute_capabilities` entry is strictly above
  that same entry's own `min_compute_capability`.
- `.github/scripts/runtime-descriptor-immutability.test.mjs` fails when a
  descriptor's `descriptor_id` is unchanged against its own version on the
  base branch but the content differs (a descriptor absent there, such as a
  new engine's, passes).
- `ajv` validates `runtimes/environments/linux.json` against
  `runtimes/environments/linux.schema.json`, and
  `runtimes/environments/windows.json` against
  `runtimes/environments/windows.schema.json`.
- `node --test` over `.github/scripts/environment-manifest.test.mjs` and
  `.github/scripts/environment-manifest-windows.test.mjs` (fixture
  accept/reject against each platform's schema),
  `.github/scripts/environment-manifest-integrity.test.mjs` (on the real
  manifests: `manifest_id` starts with `platform + "-"`; in `linux.json`
  `recipes[].recipe_id` is unique and `distributions` are unique by
  `(id, version_id, arch)` within a recipe) and
  `.github/scripts/environment-manifest-immutability.test.mjs` (fails when a
  manifest's `manifest_id` is unchanged against the base branch but the
  content differs).
- `ajv` validates `app/latest.json` against `app/schema.json`, and every
  download URL must sit under the manifest's own `tag` and `version`.

You cannot merge a PR until CI is green.

## Local validation

`make validate` is the one command that runs every gate above, including all
the `node --test` scripts (fixtures, cross-field integrity, `descriptor_id`
and `manifest_id` immutability) — the same checks CI runs on a PR.

If you want to run the schema checks individually before pushing:

```bash
npx ajv-cli@5 validate -s providers/schema.json -d providers/registry.json --strict=false
npx ajv-cli@5 validate -s models/schema.json    -d models/recommended.json   --strict=false
npx ajv-cli@5 validate -s models/schema.staff-picks.json -d models/staff-picks.json --strict=false
npx ajv-cli@5 validate -s models/schema.decision.json -d models/decision.json --strict=false
node .github/scripts/decision-catalog-check.mjs
npx ajv-cli@5 validate -s backends/schema.json  -d backends/manifest.json     --strict=false
npx ajv-cli@5 validate -s backends/turboquant-schema.json -d backends/turboquant-manifest.json --strict=false
npx ajv-cli@5 validate -s backends/sdcpp-schema.json -d backends/sdcpp-manifest.json --strict=false
npx ajv-cli@5 validate -s backends/mlx-schema.json -d backends/mlx-manifest.json --strict=false
npx ajv-cli@5 validate -s runtimes/schema.json -d runtimes/tensorrt-llm.json --strict=true
npx ajv-cli@5 validate -s runtimes/schema.json -d runtimes/vllm.json --strict=true
npx ajv-cli@5 validate -s runtimes/environments/linux.schema.json -d runtimes/environments/linux.json --strict=true
npx ajv-cli@5 validate -s runtimes/environments/windows.schema.json -d runtimes/environments/windows.json --strict=true
npx ajv-cli@5 validate -s app/schema.json -d app/latest.json --strict=false
```

## Security

- API keys must never appear in this repository.
- The registry is served via HTTPS from `raw.githubusercontent.com`.
- Atomic Chat clients ignore the `api_key` field even if a malicious commit slips
  through; user-supplied keys live only in the local OS keychain.

## License

See the project's primary license in the main Atomic Chat repository.
