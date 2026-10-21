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
  media.json         # Image and video models of cloud and self-hosted providers (read by core)
  schema.media.json  # JSON Schema (Draft-07) for the remote media catalog
models/
  recommended.json   # Recommended models surfaced in onboarding (frozen shape)
  schema.json        # JSON Schema (Draft-07) for the recommended-models manifest
  staff-picks.json   # Curated Staff Picks list shown by default in Hub
  schema.staff-picks.json # JSON Schema (Draft-07) for the staff-picks manifest
  decision.json      # Decision models (TurboQuant checkpoints and llama.cpp GGUFs)
  schema.decision.json # JSON Schema (Draft-07) for the decision catalog
  embedding.json     # Embedding models served on /v1/embeddings (llama.cpp GGUFs)
  schema.embedding.json # JSON Schema (Draft-07) for the embedding catalog
  atomic-prism-models.json # Which Bonsai GGUF files need PrismML llama.cpp (atomic-prism)
  schema.atomic-prism-models.json # JSON Schema (Draft-07) for the Prism model rules
  foundry-local-models.json # Foundry Local model sources: resolver, Microsoft catalog, curated models
  schema.foundry-local-models.json # JSON Schema (Draft-07) for the Foundry Local model list
backends/
  llamacpp-upstream-releases.json # Mirrored llama.cpp releases with min_core_version (cores >= 0.15.0)
  llamacpp-upstream-releases-schema.json # JSON Schema (Draft-07) for the release list
  manifest.json            # Legacy llama.cpp catalog for cores < 0.15.0 (one release every core runs)
  schema.json              # JSON Schema (Draft-07) for the backends manifest
  turboquant-manifest.json # TurboQuant backend catalog (one unified release tag)
  turboquant-schema.json   # JSON Schema (Draft-07) for the TurboQuant manifest
  atomic-prism-manifest.json # PrismML llama.cpp releases (candidate / approved per asset)
  atomic-prism-schema.json   # JSON Schema (Draft-07) for the PrismML manifest
  sdcpp-manifest.json      # stable-diffusion.cpp build catalog (read by core)
  sdcpp-manifest.staging.json # sd.cpp candidate slot: test builds, then sdcpp-approve.yml
  sdcpp-schema.json        # JSON Schema (Draft-07) for the sd.cpp manifest
  mlx-manifest.json        # The pinned mlx-server build (read by core and the desktop Makefile)
  mlx-schema.json          # JSON Schema (Draft-07) for the MLX manifest
  foundry-local-manifest.json # microsoft/foundry-local releases (read by core)
  foundry-local-schema.json   # JSON Schema (Draft-07) for the Foundry Local manifest
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
  workflows/upstream-approve.yml # Approves a mirrored llama.cpp tag (engine update pipeline)
  workflows/mirror-prism.yml    # Mirrors + signs a PrismML release, lists it as candidate (engine update pipeline)
  workflows/prism-approve.yml   # Approves a listed PrismML release (engine update pipeline)
  workflows/mirror-sdcpp.yml    # Mirrors + signs an sd.cpp build from the Atomic fork into a manifest
  workflows/sdcpp-approve.yml   # Moves a checked sd.cpp build from staging to the live manifest
  actions/windows-code-sign/    # Authenticode signing via DigiCert KeyLocker
  scripts/mirror.mjs            # Asset whitelist + manifest generation
  scripts/upstream-releases.mjs # Release list upkeep: add, approve, promote, withdraw, prune, check
  scripts/prism-manifest.mjs    # PrismML release list: latest, add, gate, approve, withdraw, check
  scripts/upstream-verify.mjs   # engine-candidate check of a mirrored tag, and the approval gate
  scripts/sdcpp-approve.mjs     # sd.cpp approval: check the staged manifest, write the live one
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

## Embedding models

`models/embedding.json` lists the embedding models of the Hub's Embedding
category: models that turn an input into a vector, served on the Local API
Server's OpenAI-compatible `/v1/embeddings`. The app downloads every listed
file into `<data>/embedding/models/<id>/`, checking bytes and sha256, and the
core starts one `llama-server --embedding` for the model the user turned on.
One embedding model runs at a time, beside the chat model; API clients pick it
by passing its `id` as `model`.

Every model runs on stock llama.cpp (`engine: "llamacpp-upstream"`,
`format: "gguf"`): one GGUF (`role: "model"`), plus an `mmproj` projector for a
model that reads more than text. Until the user's llama.cpp reaches a model's
`min_engine`, the app lists the model with an "update llama.cpp" notice
instead of a Start button. EmbeddingGemma 2 (`gemma-embedding2`) needs `b11454`.

| Field              | Required | Notes                                                                                          |
| ------------------ | -------- | ---------------------------------------------------------------------------------------------- |
| `id`               | yes      | Folder name under `embedding/models` and the model id the engine answers with (`model` in API calls). |
| `repo`, `revision` | yes      | Hugging Face repo and the full commit every file is pinned to.                                 |
| `files`            | yes      | `path`, `role`, `bytes`, `sha256` from the Hugging Face API. One `model`, at most one `mmproj`. |
| `context`          | yes      | Tokens per input the engine is started with: `-c`, and `-b`/`-ub` (an encoder reads one whole input per batch, media tokens included). |
| `max_context`      | yes      | The longest input the model was trained for.                                                   |
| `dims`             | yes      | Vector length `/v1/embeddings` returns.                                                        |
| `matryoshka_dims`  | no       | Shorter lengths a vector can be cut to (re-normalize after cutting). The server never cuts.    |
| `pooling`          | yes      | `mean`, `cls` or `last`: passed as `--pooling`.                                                |
| `modalities`       | yes      | `text`, plus `image` / `audio` for a model with an `mmproj`.                                   |
| `image_max_tokens` | no       | `--image-max-tokens`: the token budget one image is resized to, at most half of `context`.     |
| `prompts`          | no       | `query` / `document` text the model expects before each text input. Shown in the app for clients to copy; the server never adds it. |
| `icon`             | yes      | Bundled logo key (`web-app/src/lib/model-logo.ts`, `ICON_KEY_LOGOS`).                          |
| `min_engine`       | yes      | The oldest upstream tag that runs the model, `b<build>`.                                       |
| `default`          | no       | The model the app suggests first. Exactly one.                                                 |

An input beyond text goes in a `content` array of one `input` item and gives
one vector; text and media can be mixed in one item:

```json
{
  "model": "embeddinggemma-2",
  "input": [
    "task: search result | query: a red square",
    { "content": [{ "type": "image_url", "image_url": { "url": "data:image/png;base64,<base64 png or jpeg>" } }] },
    { "content": [{ "type": "input_audio", "input_audio": { "data": "<base64 wav, mp3 or flac>" } }] }
  ]
}
```

Media must be inline (`data:` URLs or base64): the core refuses links, so the
engine never fetches a URL a client hands it, and answers malformed or
undecodable media with a 400 that names the field. `dimensions` other than
`dims` is refused too: the server returns full vectors, and a client that wants
one of the `matryoshka_dims` keeps the first values and L2-normalizes them. A new logo key needs the image in
the app first, then the `icon` value here.

## Remote media catalog

`providers/media.json` lists the image and video generation models that cloud
providers and self-hosted servers offer through the core. Only the core reads
it (released apps never fetch it). The core answers the app's media pickers
from it and routes `/v1/images/generations`, `/v1/images/edits` and
`/v1/videos` for these models to the provider.

Per provider id (a provider of `providers/registry.json`, or `automatic1111` and
`sdcpp-server`, which the app ships itself) there is an `image` and/or a `video`
section:

| Field             | Notes                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| `api`             | The core adapter (dialect) that speaks this provider's media API, e.g. `openai-images`, `gemini-veo`.   |
| `models[].id`     | The id the provider takes as `model`, and the id clients pass to the core.                              |
| `models[].default`| Offered as soon as the provider is connected. At most one per provider and kind.                        |
| `models[].api`    | Overrides the section's adapter for one model (MiniMax H3 uses the V2 video API).                       |
| `models[].workflows` | Image: `create`, `transform`, `inpaint`, `reference`, `edit`. Video: `create`, `image-to-video`.     |
| `models[].params` | What the generation form offers: sizes, aspect ratios, resolutions, durations, quality, seed and so on. A missing key is a hidden control. |
| `models[].options`| Adapter settings for one model (the Hugging Face inference provider, the NVIDIA request schema).        |

`dialects` holds each adapter's default workflows and parameters. The core uses
them for a model a provider lists live that this file does not name.

**No hosts here.** An adapter derives every URL from the provider's registered
`base_url` in code, so this file can never send an API key to a new host.

**Compatibility.** Changes are additive. A core that does not know a dialect
or a parameter skips that entry and keeps the rest. Raise `catalog_version` on
every change; the core keeps the newer of its bundled baseline and this file.
Bump `schema_version` only for a breaking change, and only after the core
parser accepts the new version. A model that stops working at a provider is
removed here; no release is needed.

## llama.cpp backends manifest

> Cores from 0.15.0 read the [upstream release list](#upstream-release-list)
> instead and use this file only as a fallback. It stays for the cores already
> released, so it only ever names a release every core runs.

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

### Upstream release list

[`backends/llamacpp-upstream-releases.json`](backends/llamacpp-upstream-releases.json)
lists the mirrored releases newest first, the same way the PrismML manifest
does. Each release names the oldest core it runs on (`min_core_version`) and
each archive its `validation`:

- `candidate`: mirrored, not verified. No core offers it unless the user
  opted into unverified builds.
- `approved`: verified for the cores the release names and offered to them.

A core takes, per backend, the newest release that is not withdrawn, whose
`min_core_version` it meets and whose archive for that backend is approved.
That is how an engine update that needs a core change reaches only the cores
that have the change: list it with `min_core_version` set to the core that
shipped the change. `0.0.0` means every core that reads the list.

```json
{
  "$schema": "./llamacpp-upstream-releases-schema.json",
  "schema_version": 1,
  "updated_at": "2026-10-13T00:00:00Z",
  "upstream_repo": "ggml-org/llama.cpp",
  "download_base": "https://github.com/AtomicBot-ai/atomic-chat-conf/releases/download",
  "releases": [
    {
      "tag": "b11500",
      "commit": "0000000000000000000000000000000000000000",
      "published_at": "2026-10-10T00:00:00Z",
      "min_core_version": "0.16.0",
      "notes_url": "https://github.com/ggml-org/llama.cpp/releases/tag/b11500",
      "assets": [
        {
          "name": "llama-b11500-bin-macos-arm64.tar.gz",
          "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
          "size": 12087702,
          "validation": "approved"
        }
      ]
    }
  ]
}
```

- The backend is read from the archive name, as in `backends/manifest.json`.
  The `cudart-*` companions are not listed: they stay on the ggml-org CDN.
- `withdrawn: { "reason": "..." }` pulls a release from offers. Installed
  packs are kept.
- `backends/manifest.json` must name an approved release of the list with
  `min_core_version` `0.0.0`, with the same hashes. CI enforces it
  (`upstream-releases.mjs check`), so the file older cores follow can only
  move to a release every core runs.
- A newer release that is approved for every backend an older one is, for the
  same or older cores, replaces it; the mirror drops replaced releases from
  the list (the one `backends/manifest.json` names stays).

### Signed mirror

Upstream ships its macOS binaries ad-hoc-signed and its Windows binaries
unsigned. Atomic Chat both downloads these archives at runtime and bundles one
in its installer, so before this pipeline existed the app either shipped an
unsigned binary or re-signed it on each developer's machine. Now one CI run
per tag produces a single artifact that serves both paths.

```bash
make mirror TAG=b10405          # run the pipeline, list the tag as a candidate, wait for it
make mirror TAG=b10405 PUBLISH=1 # same, then promote it for every core (moves backends/manifest.json)
make mirror-select TAG=b10405   # dry run: show which assets that tag would mirror
make verify-release TAG=b10405  # check the published macOS asset's signature
```

[`.github/workflows/mirror-upstream.yml`](.github/workflows/mirror-upstream.yml)
downloads the whitelisted assets from ggml-org, signs the Windows binaries
with DigiCert KeyLocker and the macOS binaries with our Developer ID
(hardened runtime, secure timestamp), repacks each archive with its original
layout, publishes them under the upstream tag, then lists the tag in the
release list as a candidate, with a `sha256` per archive, and commits it to
main. Linux archives pass through byte-for-byte: there is no Linux signing
mechanism here. With `PUBLISH=1` it also promotes the tag and regenerates
`backends/manifest.json`; `MIN_CORE=0.16.0` lists it for cores from that
version.

The lists move **after** the upload succeeds, never before — clients
resolve download URLs from them, so the reverse order would hand them 404s.
A tag with approved archives is never re-mirrored: a re-run re-signs every
archive, and clients already hold the old hashes. Older mirrored releases are
pruned (`RETAIN=3` by default), except the ones the release list still offers
and the one `backends/manifest.json` names.

Required secrets: `SM_API_KEY`, `SM_CLIENT_CERT_FILE_B64`,
`SM_CLIENT_CERT_PASSWORD` (Windows), `APPLE_CERTIFICATE`,
`APPLE_CERTIFICATE_PASSWORD` (macOS). The temporary keychain the macOS job
creates gets a password generated on the runner, so that one is not a secret.

### How to update the backends manifest

1. Run `make mirror TAG=<tag>`. Pick the newest **complete** `b<build>`
   release: releases publish their tag before every asset finishes uploading,
   and ggml-org's `latest` is not a build at all. The pipeline fails loudly if
   a required asset is missing from the tag, which is the check that used to
   be manual. The tag lands as a candidate.
2. Run `make upstream-verify TAG=<tag>`. It starts core's `engine-candidate`
   workflow on the signed archives mirrored here (`candidate_id=conf-<tag>`):
   core's suites and its live llama.cpp tests on five OSes, the current pin
   beside the candidate. It waits for the run and prints the verdict: `pass`,
   `fail` or `incomplete`, with what failed.
3. On a branch, approve what passed and open a pull request:
   - every core runs it: `make upstream-promote TAG=<tag>` (also moves
     `backends/manifest.json`);
   - it needs a core change: `make upstream-approve TAG=<tag> MIN_CORE=<core>`,
     once that core is released;
   - some backends failed: add `ONLY=<archive>,<archive>` to approve the rest.

   Both refuse a tag that no successful `engine-candidate` run names; `FORCE=1`
   goes ahead anyway. Merge the approval before the next `make mirror`: a
   newer tag replaces a release with nothing approved, so the mirror drops it
   from the list (and, past `RETAIN`, deletes its mirrored release), and it can
   no longer be approved.
4. A release that turns out bad: `make upstream-withdraw TAG=<tag> REASON="..."`.

### Automatic updates

The engine update pipeline
([atomic-hatchet-pipeline](https://github.com/AtomicBot-ai/atomic-hatchet-pipeline),
Hatchet task `engine-bump`) runs these steps itself once a day, for the newest
llama.cpp build its checks call green:

1. `mirror-upstream.yml` with `candidate_id=<id>` (it finds its run by
   `[cid:<id>]` in the title) and `min_core_version` set to the core the
   latest Atomic Chat release ships (`atomicCore.version` in its
   `package.json`), so an approved build reaches users without an app release.
2. Core's `engine-candidate` on the signed archives
   (`repo=AtomicBot-ai/atomic-chat-conf`, `core_ref=<that core release>`, or
   the first newer core release that can check the engine).
   Anything but `pass` stops here: the tag stays a candidate.
3. [`upstream-approve.yml`](.github/workflows/upstream-approve.yml), the CI
   counterpart of `make upstream-approve`: the same gate, then `approve` for
   cores from `min_core_version` and a commit to main. It never promotes, so
   `backends/manifest.json` and cores before 0.15.0 stay on their release.

A re-run for a tag that is already approved changes nothing. Both workflows
share the `mirror-upstream` concurrency group, so they never rewrite the
release list at the same time. To stop automatic releases, turn them off in
the pipeline (`PUBLISH_ENABLED=false`); a bad one is withdrawn as above.

Cores from 0.15.0 re-read the list every hour; older cores read
`backends/manifest.json` when they start. Do not edit `backends/manifest.json`
by hand: CI refuses a tag the release list does not approve for every core.

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

## PrismML backends manifest

[`backends/atomic-prism-manifest.json`](backends/atomic-prism-manifest.json)
lists the builds of PrismML's llama.cpp fork
([PrismML-Eng/llama.cpp](https://github.com/PrismML-Eng/llama.cpp)) the
`atomic-prism` provider runs Bonsai models on (PQ2_0, PTQ1_0 tensor types
upstream llama.cpp does not load). Schema:
[`backends/atomic-prism-schema.json`](backends/atomic-prism-schema.json).

- Tags are `prism-b<build>-<sha7>`; `<build>` is the upstream llama.cpp build
  the fork is cut from, so `prism-b10787-…` is older than upstream `b11734`.
- PrismML ships its macOS binaries ad-hoc-signed and its Windows binaries
  unsigned, so they are mirrored and signed like upstream llama.cpp and
  sd.cpp: [`mirror-prism.yml`](.github/workflows/mirror-prism.yml) signs the
  Windows binaries (DigiCert KeyLocker, after dropping every tool but
  `llama-server`) and the macOS ones (Developer ID, hardened runtime),
  publishes the desktop archives as a release here under the PrismML tag and
  lists them with their own `sha256`. Linux archives and the cudart companions
  pass through byte-for-byte.
- `download_base` is one for the whole manifest. It points here only once
  every listed tag is mirrored; builds listed before signing began are mirrored
  as they are (`SIGN=0`), keeping the hashes clients hold. An approved build is
  never re-signed.
- Per release: `min_core_version`, optional `withdrawn`; per asset:
  `candidate` or `approved`. A core offers the newest release it meets whose
  asset for its machine is approved (or a candidate, with "Allow unverified
  PrismML builds" on). Windows CUDA packs need their `cudart` companion approved
  with them.
- [`models/atomic-prism-models.json`](models/atomic-prism-models.json) says
  which Bonsai files need PrismML and from which build (`min_prism_build`).
  It is edited by hand.

### How to update the PrismML manifest

1. `make prism-mirror TAG=prism-b10787-73bfe6c MIN_CORE=0.18.2` — mirror
   and sign the release and list it as `candidate` (runs CI).
2. Run core's `engine-candidate` workflow with `engine=atomic-prism`,
   `tag=<tag>`, `repo=AtomicBot-ai/atomic-chat-conf` (the signed archives) and
   `core_ref` set to the core release the build is for. It must pass.
3. `make prism-approve TAG=… MIN_CORE=0.18.2` — refuses a tag no passing
   engine-candidate run names (`FORCE=1` skips that), then approves every
   asset, GPU packs and companions included: CI checks CPU builds only.
4. Open a PR and merge once CI is green. A bad release is pulled with
   `make prism-withdraw TAG=… REASON="…"`.

When a new Bonsai packing needs a newer build, raise `min_prism_build` in the
model rules by hand. Core keeps an offline copy of this manifest
(`src/backend/catalog/prism-manifest-baseline.json`); re-copy it there when it
matters for offline first runs.

### Automatic PrismML updates

The engine update pipeline
([atomic-hatchet-pipeline](https://github.com/AtomicBot-ai/atomic-hatchet-pipeline),
engine `atomic-prism`) runs the same steps for a build its checks call green,
once it is enabled there (`PUBLISH_ENGINES`):

1. [`mirror-prism.yml`](.github/workflows/mirror-prism.yml) with
   `candidate_id=<id>` and `min_core_version` set to the core the latest Atomic
   Chat release ships: sign, release here, list as candidate.
2. Core's `engine-candidate` on the signed archives
   (`repo=AtomicBot-ai/atomic-chat-conf`, `core_ref=<that core release>`, or the
   first newer one that has the PrismML check: v0.18.6 and later). Anything but
   `pass` stops here: the tag stays a candidate.
3. [`prism-approve.yml`](.github/workflows/prism-approve.yml): the same gate,
   then `approve` for cores from `min_core_version` and a commit to main.

Both workflows push to main and share the `prism-manifest` concurrency group.
The mirror publishes the release before it touches the manifest, so a listed
archive is always downloadable.
A re-run for a tag that is already listed or approved changes nothing.

## Updating stable-diffusion.cpp

Core installs `sd-server` from
[`backends/sdcpp-manifest.json`](backends/sdcpp-manifest.json) (schema:
[`backends/sdcpp-schema.json`](backends/sdcpp-schema.json)): one `tag_name`,
one archive per backend id with its `sha256` and `size`, downloaded from this
repository's releases (`download_base`). Cores re-read it within the hour.

- Every archive is built by the Atomic fork,
  [AtomicBot-ai/stable-diffusion.cpp](https://github.com/AtomicBot-ai/stable-diffusion.cpp)
  (workflow `Release (Atomic)`: a release `master-<n>-<sha7>` per leejet tag),
  and signed here by [`mirror-sdcpp.yml`](.github/workflows/mirror-sdcpp.yml):
  Authenticode on Windows, Developer ID on macOS; Linux archives and the
  cudart companion pass through byte-for-byte. With `atomic_rev` (the fork
  commit the archives were built at, 7 hex) the release here and the manifest
  are tagged `master-<n>-<sha7>-a<rev>`.
- Core moves an installed engine only to a higher build number `<n>`, or from
  a bare tag to the `-a<rev>` rebuild of it; two rebuilds of one tag are
  equal, and it never moves back.
- [`backends/sdcpp-manifest.staging.json`](backends/sdcpp-manifest.staging.json)
  is the candidate slot: the mirror writes it, test builds of the app read it
  (`ATOMIC_SDCPP_MANIFEST_URL`), core's `engine-candidate` checks the build it
  names, and [`sdcpp-approve.yml`](.github/workflows/sdcpp-approve.yml) copies
  it into the live manifest. It names the newest candidate, passed or not.

### By hand

1. In the fork, run `Release (Atomic)` with `upstream_tag=master-<n>-<sha7>`
   and `publish=true`. Note the fork commit it built: that is `atomic_rev`.
2. Mirror into the staging slot:

   ```bash
   gh workflow run mirror-sdcpp.yml --repo AtomicBot-ai/atomic-chat-conf \
     -f tag=master-<n>-<sha7> -f atomic_rev=<rev> \
     -f manifest_path=backends/sdcpp-manifest.staging.json
   ```

   It publishes the signed release `master-<n>-<sha7>-a<rev>` here, then
   commits the staging manifest to main.
3. Run core's `engine-candidate` with `engine=sd-cpp`,
   `repo=AtomicBot-ai/atomic-chat-conf`, `tag=master-<n>-<sha7>-a<rev>` and
   `conf_ref` at or after the mirror's commit. It must pass. Its
   `results.json` (artifact `engine-candidate-results`) records the conf
   commit it read as `conf.sha`.
4. Approve:

   ```bash
   gh workflow run sdcpp-approve.yml --repo AtomicBot-ai/atomic-chat-conf \
     -f tag=master-<n>-<sha7>-a<rev> -f conf_sha=<conf.sha>
   ```

`sdcpp-approve.yml` does nothing when the live manifest already names the tag.
Otherwise it refuses unless:

- `backends/sdcpp-manifest.staging.json` at `conf_sha`, a commit of main,
  names the tag, downloads from this repository, and lists every archive with
  the `size` and `sha256` of this repository's release of the tag (the
  release's `digest`);
- a successful `engine-candidate` run in core has the tag as a word of its
  title (the fork's `master-<n>-<sha7>` run does not count), and its
  `results.json` says `status: pass`, `engine: sd-cpp`, `candidate.repo`
  `AtomicBot-ai/atomic-chat-conf` and `candidate.tag` the tag
  (`upstream-verify.mjs gate --engine sd-cpp`).

Then it writes that staging manifest, with a new `updated_at`, to
`backends/sdcpp-manifest.json`, validates it like CI does and pushes
`chore(sdcpp-manifest): approve <tag>` to main. The live manifest gets the
staging manifest of `conf_sha`, not of main, so a newer candidate in the slot
does not matter.

The mirror refuses the tag the live manifest names: a re-run re-signs every
archive in place, and clients already hold the old hashes. Mirroring with
`manifest_path=backends/sdcpp-manifest.json` still writes the live manifest
directly, without the check; it is for emergencies only.

### Automatic sd.cpp updates

The engine update pipeline
([atomic-hatchet-pipeline](https://github.com/AtomicBot-ai/atomic-hatchet-pipeline),
Hatchet task `engine-bump`, engine `sd-cpp`) runs the same steps for a fork
build its checks call green, once it is enabled there (`PUBLISH_ENGINES`):

1. `mirror-sdcpp.yml` with `tag`, `atomic_rev`,
   `manifest_path=backends/sdcpp-manifest.staging.json`,
   `publish_manifest=true` and `candidate_id=<id>` (it finds its run by
   `[cid:<id>]` in the title).
2. Core's `engine-candidate` on the signed release
   (`repo=AtomicBot-ai/atomic-chat-conf`, `tag=master-<n>-<sha7>-a<rev>`, the
   staging manifest at `conf_ref`). Anything but `pass` stops here: the build
   stays in the staging slot and never goes live.
3. `sdcpp-approve.yml` with `tag`, `conf_sha` (the run's `results.json`
   `conf.sha`) and `candidate_id`.

Every core gets the build: sd.cpp has no `min_core_version`. Both workflows
share the `mirror-sdcpp` concurrency group, so the release and the manifests
are never rewritten at the same time. To stop automatic releases, turn them off
in the pipeline.

### Rolling back

Revert the approval commit (`chore(sdcpp-manifest): approve <tag>`) on main.
The live manifest names the previous tag again, and cores that have not
installed the bad build yet stop being offered it. Cores that have installed
it stay on it, because core never moves an engine back; they leave it only for
a newer build number, so the fix is the next build through the steps above.
The revert works only while the previous tag's release still exists here: the
mirror prunes all but the newest `retain` sd.cpp releases (3 by default),
keeping only the tags the manifests name.

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

## Foundry Local runtime manifest

[`backends/foundry-local-manifest.json`](backends/foundry-local-manifest.json)
lists the `microsoft/foundry-local` releases Atomic Chat core installs as the
`foundry-local` engine build: the native Foundry Local library and ONNX
Runtime GenAI that run the `foundry-local` provider's models. Schema:
[`backends/foundry-local-schema.json`](backends/foundry-local-schema.json);
integrity checks:
[`.github/scripts/foundry-local-manifest-check.mjs`](.github/scripts/foundry-local-manifest-check.mjs).

```json
{
  "$schema": "./foundry-local-schema.json",
  "schema_version": 1,
  "upstream_repo": "microsoft/foundry-local",
  "releases": [
    {
      "tag": "v2.1.0",
      "published_at": "2026-09-30T00:43:42Z",
      "min_core_version": "0.18.0",
      "c_api_version": 2,
      "notes_url": "https://github.com/microsoft/foundry-local/releases/tag/v2.1.0",
      "assets": [
        { "platform": "macos-arm64", "name": "foundry-local-osx-arm64.tgz", "size": 52293589, "sha256": "2eeb…080a" }
      ]
    }
  ]
}
```

Core reads it from `main` with an hour's cache and a copy on disk, and installs
a release only when the client asks (`POST /atomic/v1/engine-builds/foundry-local/install`).
The archive is downloaded straight from the upstream GitHub release,
`github.com/<upstream_repo>/releases/download/<tag>/<name>`, and checked
against `size` and `sha256` before it is unpacked. `ATOMIC_FOUNDRY_LOCAL_MANIFEST_URL`
(`https://` or `file://`) points core at another copy during development.

### Fields

- `schema_version` — `1`. `upstream_repo` — always `microsoft/foundry-local`.
- `releases` — newest first by `published_at`. Each release names its upstream
  `tag` (`vX.Y.Z`), the upstream `published_at`, `notes_url`, and:
  - `min_core_version` — the oldest core that understands the entry. **Core
    skips a release whose `min_core_version` is newer than itself**, so a
    release that needs new core code can be listed without breaking cores
    already installed.
  - `c_api_version` — `FOUNDRY_LOCAL_API_VERSION` from
    `sdk_v2/cpp/include/foundry_local/foundry_local_c.h` at that tag. **Core
    skips a release whose `c_api_version` its host does not support**: a C API
    bump changes the structures the host passes to the library.
  - `assets` — one archive per platform, all five required: `win-x64`,
    `win-arm64`, `macos-arm64`, `linux-x64`, `linux-arm64`. Core selects by
    `platform`, never by parsing `name`. `size` and `sha256` come from the
    GitHub asset `digest`; the pinned hash is the only check on what core
    loads into its own process.

Besides the schema, CI rejects a duplicate `tag`, a duplicate `platform` or
asset name within a release, a release missing one of the five platforms, and
releases out of `published_at` order.

### A release is never rewritten

Once a release entry is on `main`, its fields do not change: installed builds
are identified by tag, and a different archive under the same tag would fail
every install's `sha256` check. A new upstream release is a **new entry at the
top**; a broken one is removed (new installs stop within the hour), not edited.

### How to add a release

```bash
gh api repos/microsoft/foundry-local/releases/tags/v2.1.0 --jq '{tag: .tag_name, published_at, notes_url: .html_url, assets: [.assets[] | {name, size, sha256: (.digest | ltrimstr("sha256:"))}]}'
gh api "repos/microsoft/foundry-local/contents/sdk_v2/cpp/include/foundry_local/foundry_local_c.h?ref=v2.1.0" --jq .content | base64 -d | grep 'define FOUNDRY_LOCAL_API_VERSION'
```

Map each asset to its `platform` (`osx-arm64` is `macos-arm64`), set
`min_core_version` to the first core release that supports this release,
insert the entry at the top of `releases`, run `make validate`, and open a PR.

## Foundry Local model list

[`models/foundry-local-models.json`](models/foundry-local-models.json) tells
the app where Foundry Local models come from and which of them Atomic Chat has
curated. Schema:
[`models/schema.foundry-local-models.json`](models/schema.foundry-local-models.json);
integrity checks:
[`.github/scripts/foundry-local-models-check.mjs`](.github/scripts/foundry-local-models-check.mjs).

> **The endpoints are undocumented.** Both the resolve endpoint and the
> catalog are internal Microsoft APIs that answer without an account. They can
> change without notice. Small changes (a host, a path, a region) are fixed by
> editing this file, which reaches clients within the hour; a changed response
> format needs an app release.

**The list currently has no curated models** (`"models": []`): hashing the
first ten models means downloading 212 GB, which has not been done yet. Until
then the Hub shows the Microsoft catalog only, marked "Microsoft catalog, not
verified by Atomic Chat".

### Who reads it

The app reads it from `main` with an hour's cache and keeps the last accepted
copy when the fetch fails. In the Model Hub, under the "Foundry Local" format,
it shows the curated models first and then the chat models of the Microsoft
catalog at `catalog.url`. A catalog variant with the same `asset_id` and
`version` as a curated one is shown as the curated entry. The app downloads a
variant itself, from Azure Blob Storage, through the link `resolver` returns;
core never downloads Foundry Local models.

A curated file is checked by `size` and `sha256` from this list. A catalog
variant has no hash anywhere (the API does not publish one, and Microsoft's own
client checks size only), so it is checked by the sizes in its container
listing — which is why only a curated entry counts as verified.

### Fields

- `schema_version` — `1`. The app ignores a list with a higher one and keeps
  its last accepted copy.
- `resolver.url_template` — the resolve URL, with `{region}` and `{asset_id}`
  (URL-encoded by the app). The answer's `blobSasUri` is a read+list SAS link
  to the variant's blob container that lives for a few hours; on a 403 the app
  resolves again and resumes.
- `resolver.regions` — tried in order until one answers.
- `catalog.url` — the Microsoft catalog (`asset-gallery`) the app queries.
- `models[]` — `id`, `name`, `description`, `task` (`chat`), `license`,
  `context_length` (the largest of the variants), `tools`, `reasoning`, and
  `variants[]`:
  - `id` — unique across the list: it names the download and the folder
    `<data>/foundry-local/models/<id>/`. The catalog name, lowercased.
  - `device` (`cpu`, `gpu`, `npu`) and `execution_provider` (`cpu`, `cuda`,
    `webgpu`, `openvino`, `qnn`, `vitisai`; never TensorRT-RTX).
  - `platforms` — where the variant is offered: `cpu` on all five; `cuda` on
    `win-x64` and `linux-x64`; `webgpu` on Windows and `macos-arm64`; `qnn`,
    `openvino`, `vitisai` on the Windows platform the accelerator exists for.
  - `context_length` — only when the variant's context is smaller than the
    model's (NPU builds are compiled for 4K); the app uses it instead.
  - `source` — `{kind: "azureml", asset_id, version, path_prefix}`: the full
    asset id as the catalog spells it, its version, and the folder inside the
    container (`kvTags.directoryPath`).
  - `files[]` — `path` (relative to `path_prefix`, and to the variant folder
    on disk), `size`, `sha256`. At least one.

Besides the schema, CI rejects duplicate model or variant ids, the same asset
twice, a duplicate file path within a variant, `.`/`..` path segments, a model
without variants, a resolve template missing `{region}` or `{asset_id}`, a
non-https `catalog.url`, a variant offered on a platform its execution
provider does not run on, and a variant `context_length` not smaller than the
model's.

### New kinds of source go next to the old ones

The app skips a variant whose `source.kind`, execution provider or device it
does not know, and a model left with no variants; the rest of the list still
applies. So a new kind of source (say, `hf`) is added as **extra variants next
to the existing `azureml` ones**, never by converting them: released apps keep
the variants they understand.

### How to curate a model

1. Find its variants in the catalog (`POST` to `catalog.url` with
   `{"filters": [{"field": "labels", "operator": "eq", "values": ["latest"]}], "pageSize": 50}`,
   following `continuationToken`); keep `deploymentOptions` "Foundry Local on
   Devices" and drop `NvTensorRTRTXExecutionProvider`.
2. Resolve each variant (`resolver.url_template`). Model fields come from
   `modelEntity.kvTags`: `contextLength`, `supportsToolCalling`,
   `supportsReasoning`, `license`; `path_prefix` is `directoryPath`.
3. List the container (`<blobSasUri base>?restype=container&comp=list&prefix=<path_prefix>/&<sas>`)
   for paths and sizes only.
4. Download every file once and take `shasum -a 256`. Never copy a hash from
   anywhere else: `blobManifestDigest` uses an unknown algorithm.
5. Add the model, run `make validate`, open a PR.

## Runtime descriptors (`runtimes/`)

A runtime descriptor tells atomic-chat-core which container image a
**managed engine** (TensorRT-LLM, vLLM, SGLang) runs, pinned by digest, what host
it needs, and what that release supports. There is **one descriptor per
engine**, named after it: `runtimes/<engine_id>.json` (`tensorrt-llm.json`,
`vllm.json`, `sglang.json`), all validated by the one shared
`runtimes/schema.json`. The file
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
unavailable and leaves TensorRT-LLM as it was. The same holds for
`runtimes/sglang.json`: only a core built with the `sglang` adapter (the core
release of change `add-sglang-runtime`) reads it, and a missing or invalid
file makes SGLang unavailable without touching the other engines.

core fetches each engine's descriptor from this repository's `main` branch.
For development, the source of each engine can be overridden with
`ATOMIC_RUNTIME_DESCRIPTOR_URL_<ENGINE>` — the engine id upper-cased, `-`
replaced by `_` — set to a `file://` path or a URL:

```bash
ATOMIC_RUNTIME_DESCRIPTOR_URL_VLLM=file://$PWD/runtimes/vllm.json
ATOMIC_RUNTIME_DESCRIPTOR_URL_SGLANG=file://$PWD/runtimes/sglang.json
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

### `sglang.json` reaches `main` only after live acceptance

The same rule holds for SGLang, for the same reason: publishing
`runtimes/sglang.json` on `main` turns SGLang on for every core with the
`sglang` adapter, within the hour and without a release. The descriptor lives
on the branch of change `add-sglang-runtime` and is merged into `main` only
after the live acceptance on Linux and Windows has passed and after the app
release that ships SGLang is out; README changes may reach `main` earlier.
Until the merge, `sglang-0.5.21-r1` is unpublished and acceptance findings are
fixed in place on the branch; from the merge on it is immutable like every
other descriptor. Removing `sglang.json` from `main` switches SGLang off for
everyone without a release; vLLM and TensorRT-LLM are not affected.

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

The new id follows the [form and order](#descriptor_id-form-and-order) below:
bump the engine version when the underlying engine release changes
(`tensorrt-llm-1.2.1-r2` → `tensorrt-llm-1.3.0-r1`), or bump `n` when the
version stays the same but a data-only field changes (a new curated model, a
corrected notice, …). Each descriptor file is compared with its own
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

### `descriptor_id` form and order

A `descriptor_id` has the form `<engine_id>-<engine version>-r<n>`:

- the engine version is numbers separated by dots, with an optional
  pre-release suffix `a<k>`, `b<k>` or `rc<k>` (`1.3.0rc29`, `0.31.0`);
- `n` is the edition of that engine release in conf, starting at `1`.

`runtimes/schema.json` checks the shape with a `pattern`. The integrity
check in CI adds what the schema cannot see: the id starts with this
descriptor's own `engine_id`, and what follows `<engine_id>-` is exactly
`<engine version>-r<n>`. So `vllm-latest` and a `tensorrt-llm-…` id in
`vllm.json` both fail `make validate` and CI.

**A new descriptor of an engine MUST have a strictly greater
`descriptor_id` than the one it replaces**: a newer engine version, or the
same version with a greater `n` (`vllm-0.31.0-r1` → `vllm-0.31.0-r2` for a
new curated list on the same image). atomic-chat-core decides whether to
offer an installed engine an update by this order, comparing the installed
`descriptor_id` with the one on `main`:

1. the version's numeric parts, left to right;
2. a pre-release is older than the same version without a suffix
   (`1.3.0rc29` < `1.3.0`), and pre-releases order `a` < `b` < `rc`, then
   by `k`;
3. for an equal version, by `n`.

An id that does not parse, or belongs to another engine, is never newer. So
publishing an older or equal id is not offered to installed engines at all,
and rolling a descriptor back does not make every installation "update"
backwards. CI does not compare an id with the one it replaces; keeping it
greater is the maintainer's job. The order is specified in the
`engine-lifecycle` capability of atomic-chat-spec
([`openspec/specs/engine-lifecycle/spec.md`](https://github.com/AtomicBot-ai/atomic-chat-spec/blob/main/openspec/specs/engine-lifecycle/spec.md),
requirement "Порядок дескрипторов managed-движка"), and core implements it.

### Installed engines stay pinned to their descriptor

An installation records the `descriptor_id` it was set up with and keeps
using it. Publishing a new descriptor here therefore only affects **new**
installs and never changes, re-downloads or breaks an existing one.

A core release of change `unify-engine-lifecycle` and later also **reports**
that `main` holds a descriptor newer than the installed one (by the order
above), and updates the engine only when a client asks it to. The update is a
reinstall: core removes the installation and keeps the models, then starts
setup with the new descriptor, which waits for the user's consent. Core never
starts it by itself. Older cores offer nothing: the user removes the engine
and sets it up again, which picks up whatever descriptor is current then.

### How to update the engine tag

The steps below are written for TensorRT-LLM; vLLM follows the same steps
with its own sources (the vLLM source at the image's `VLLM_BUILD_COMMIT`, see
[vLLM descriptor](#vllm-descriptor-vllmjson)), and so does SGLang (the SGLang
source at the image's `SGLANG_BUILD_COMMIT`, see [SGLang
descriptor](#sglang-descriptor-sglangjson)).

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
7. Assign a new `descriptor_id`, `<engine_id>-<new version>-r1`, strictly
   greater than the current one (see [form and
   order](#descriptor_id-form-and-order)).
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

### SGLang descriptor (`sglang.json`)

`sglang-0.5.21-r1` pins the SGLang project's own image
`docker.io/lmsysorg/sglang:v0.5.21` (build commit
`e00930c5489053f26d86b179cee0d087f846acbb`, the `v0.5.21` tag, recorded in
the image as `SGLANG_BUILD_COMMIT`) for `linux/amd64` and `linux/arm64`, and
the same CUDA 13.0 base image as vLLM,
`nvcr.io/nvidia/cuda:13.0.2-base-ubuntu24.04`, for the GPU check. **Not
live-qualified yet**: every value below comes from the registry manifests,
the SGLang source at that commit and the Hugging Face API on 2026-10-13. The
live acceptance on an RTX 4070 Laptop (compute capability 8.9, 8 GB) under
Ubuntu and Windows, run by the maintainers of change `add-sglang-runtime`
with atomic-chat-core's live tests, confirms or corrects the driver floor,
the matrix rows that run on 8.9, the curated list and the parser names
before the file reaches `main`; its findings are recorded in that change's
`rulings/`.

- **Why the release tag.** A descriptor is immutable, so it pins a release
  tag. SGLang also publishes `dev` and nightly tags, which are rebuilt in
  place, and day-0 tags for single new models, which are not releases. The
  CUDA 12 line of images ended after v0.5.19, so `v0.5.21` exists only as a
  CUDA 13 build. NGC's `nvcr.io/nvidia/sglang` is not used for the same
  reasons as NGC's vLLM: it trails upstream and adds NGC terms.
- **`minimum_driver_version` `580.0`.** The image's `CUDA_VERSION` is
  `13.0.3` and its `NVIDIA_REQUIRE_CUDA` is `cuda>=13.0`; CUDA 13.0 needs the
  R580 branch on consumer cards, so the floor is that branch's first
  version, the same rule and the same value as vLLM. The image's datacenter
  brand exceptions (535 to 575 branches) are not modelled, and the probe
  image is CUDA 13.0 as well.
- **`minimum_compute_capability` `8.0`** (Ampere), as for vLLM and
  TensorRT-LLM: no older card is available to check, and a floor is not
  lowered without a live run.
- **`quantization`.** The matrix is read from the code, like vLLM's: for
  each name of the shared rule, the quantization config SGLang dispatches the
  checkpoint to (`python/sglang/srt/configs/model_config.py`, ModelOpt
  through `_parse_modelopt_quant_config`) and that config's
  `get_min_capability()`, the gate SGLang's loader applies before loading
  (`model_loader/loader.py`). Whoever moves the descriptor to a new SGLang
  release re-reads both at the new image's `SGLANG_BUILD_COMMIT`; the live
  acceptance then checks the rows it runs on 8.9. Where the result differs
  from vLLM:
  - `fp8` (ModelOpt FP8) is `8.9`: `ModelOptFp8Config` gates at 89, while
    vLLM runs it through Marlin from 8.0. Core requires every per-layer
    format of a mixed-precision checkpoint, so the ModelOpt mixed
    checkpoints with FP8 layers (`nvidia/Qwen3.8-27B-NVFP4`,
    `nvidia/Qwen3.6-35B-A3B-NVFP4`, the Nemotron 3.5 Lightning NVFP4) need
    8.9 here too, although SGLang's own mixed-precision config gates at 8.0.
    That blocks them on Ampere, where they might run; the opposite choice,
    `8.0`, would pass plain ModelOpt FP8 checkpoints that SGLang then refuses
    at load.
  - `mxfp8` is `10.0`: SGLang reads ModelOpt MXFP8 with its own `mxfp8`
    method, which gates at 100 on CUDA.
  - `ct_nvfp4` is `10.0`: compressed-tensors W4A4 NVFP4 has no fallback below
    Blackwell, SGLang raises instead.
  - `fp8_per_channel_per_token` has no row: SGLang's ModelOpt dispatch has no
    branch for that `quant_algo`. Neither does it dispatch a checkpoint whose
    top-level `quant_algo` is `FP8_PB_WO`; the `fp8_block_scales` row (8.0)
    is there for Hugging Face FP8 with 128x128 block scales (`Fp8Config`) and
    for block-FP8 layers inside a ModelOpt mixed checkpoint. A plain ModelOpt
    `FP8_PB_WO` checkpoint therefore passes the check and fails at load with
    the engine's own error; none is curated.
  - Every other row is `8.0` with no exclusions: `Fp8Config` (`hf_fp8`,
    `fp8_block_scales`) and ModelOpt NVFP4 (`nvfp4`, `w4a16_nvfp4`, and the
    mixed config) gate at 80 and fall back to Marlin weight-only kernels
    where the card lacks native FP8 or FP4; `mxfp4`, AWQ Marlin
    (`autoawq_w4a16`), GPTQ Marlin (`gptq_w4a16`, `gptq_w8a16`) and the
    compressed-tensors W4A16/W8A16, W8A8 INT8 and W8A8 FP8 schemes gate at
    80 (W8A8 FP8 below 8.9 falls back to W8A16).
  - Not listed, as for vLLM: ModelOpt `w4a16_awq` and `w4a8_awq` (not
    dispatched), bitsandbytes and GGUF.

  **Rows not checked live on 8.9.** The acceptance runs `bf16`
  (Qwen3.5-2B) and one 4-bit curated model (`autoawq_w4a16` or `ct_w4a16`).
  `fp16`, `fp8`, `fp8_block_scales`, `nvfp4`, `w4a16_nvfp4`, `hf_fp8`,
  `mxfp4`, `gptq_w4a16`, `gptq_w8a16`, `ct_w8a16`, `ct_w8a8_fp8`,
  `ct_w8a8_int8` and whichever 4-bit row it does not run come from the code
  alone on 8.9, and so does every row on 8.0/8.6, 9.0, 10.x and 12.x
  (`mxfp8` and `ct_nvfp4` do not run on 8.9 at all). A row that turns out
  wrong fails at load with the engine's own error and logs, and is fixed by a
  new `descriptor_id` without a core release.
- **`supported_architectures`.** The 45 architectures of `vllm.json` that
  SGLang 0.5.21 implements natively: the `EntryClass` names under
  `python/sglang/srt/models/`, which SGLang's registry matches exactly
  against `config.json`. Five vLLM architectures are left out because SGLang
  has no native class under the Hugging Face name: `Ernie4_5ForCausalLM`
  (SGLang registers `Ernie4_5_ForCausalLM`), `ExaoneMoeForCausalLM` (SGLang:
  `ExaoneMoEForCausalLM`), `NemotronForCausalLM`, `Qwen4ExpForCausalLM`
  (SGLang has only `Qwen4ExpForConditionalGeneration`) and
  `SeedOssForCausalLM`. SGLang would try those through its generic
  Transformers backend, which is not what this descriptor qualifies.
  Vision-language classes run text-only. SGLang 0.5.21 has a text-only
  switch, `--language-model-only`: with it the Qwen3.5 and Qwen4Exp classes
  never build or load their encoders, and every class serves with
  multimodal off, so SGLang reserves no memory for images and refuses them.
  The Gemma 3/4 and Mistral 3 classes ignore the switch for loading and
  still load their encoders (not checked live: no Gemma or Mistral model
  fits the 8 GB acceptance card). Which flag core passes is core's adapter
  decision (change `add-sglang-runtime`, `rulings/core.md`).
- **`model_families`.** Parser names are SGLang's own registry names at the
  build commit (`python/sglang/srt/function_call/parser_names.py`,
  `python/sglang/srt/parser/reasoning_parser_names.py`), chosen per family
  from the launch commands in SGLang's cookbook and SGLang's chat-template
  auto-detection (`parser/template_detection.py`). The descriptor never
  names `auto`: core declares tools and reasoning from these names, so they
  are data, not a guess at start. The rule is vLLM's: a family gets a parser
  only when it works with the checkpoint's own chat template (the adapter
  passes no `--chat-template`) and its reasoning mode is unambiguous.
  Where the names differ from vLLM's:
  - Qwen2 and Qwen3 (`Qwen2*`, `Qwen3ForCausalLM`, `Qwen3Moe*`,
    `Qwen3Next*`): tool parser `qwen`, SGLang's name for the Qwen 2.5/3
    `<tool_call>` JSON format; Qwen3.5 and later keep `qwen3_coder` and
    `qwen3`.
  - Granite 4 (`GraniteMoeHybridForCausalLM`) and EXAONE 4: `hermes`; their
    templates emit the same `<tool_call>` JSON format, and SGLang has no
    Granite parser.
  - Trinity (`AfmoeForCausalLM`): `trinity`, SGLang's parser for it, which
    also reads tool calls written inside the reasoning.
  - MiniMax-M2: `minimax-m2` and reasoning `minimax`, the parser SGLang's
    auto-detection picks for that architecture. The cookbook's
    `minimax-append-think` leaves the reasoning in the answer text.
  - Nemotron-H: `qwen3_coder` and `nemotron_3`.
  - None where SGLang has no parser for the family's format: ERNIE 4.5,
    Granite 3 (`<|tool_call|>`), HunYuan A13B (SGLang's `hunyuan` parsers
    are for the Hunyuan 3 format).
  - None where one architecture spans checkpoints with different formats or
    needs its own template, as for vLLM: Llama, DeepSeek V3/V3.2 (also
    Kimi K2 and DeepSeek V3.1), every Mistral class, Cohere 2 (SGLang's
    `cohere_command4` targets Command 4 and is unchecked on Command A and
    R7B), HunYuan dense. GLM-4.5/4.6 get `glm45`, but GLM-4.7 shares
    `Glm4MoeForCausalLM` and uses the `glm47` format: the same compromise as
    vLLM.

  `structured_output` is `true` for every family: SGLang 0.5.21 constrains
  output with xgrammar for any model.
- **`curated_models`.** All sixteen models of `vllm.json` at the same
  revisions and inventory digests, so one copy on disk serves both engines;
  every one passes SGLang's architecture list and matrix, and the tiers and
  notes are vLLM's, except that the notes of the three mixed NVFP4 + FP8
  checkpoints say their FP8 layers need compute capability 8.9 here. The
  live acceptance runs Qwen3.5-2B and one 4-bit model on 8 GB; a model it
  rejects is removed before the merge, without a new `descriptor_id`.
- **`download_bytes`** is the larger platform's compressed layers (amd64,
  15.2 GB); **`required_disk_bytes`** adds the extracted size sampled
  the same way as for TensorRT-LLM, 48 GiB (about 36 GB extracted).
- **Privacy.** SGLang 0.5.21 reports no usage statistics, and its
  OpenTelemetry tracing stays off unless it is started with `--enable-trace`.
  core starts the container with Hugging Face offline and `DO_NOT_TRACK=1`
  regardless.
- **`minimum_core_version` `0.13.6`, `minimum_app_version` `2.2.4`** are
  provisional: they are the versions the core and app change branches start
  from, so a development core accepts the file through
  `ATOMIC_RUNTIME_DESCRIPTOR_URL_SGLANG`; both are set to the actual core and
  app releases that ship SGLang before the file is merged into `main`.

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
docker buildx imagetools inspect docker.io/lmsysorg/sglang:v0.5.21

# Same without Docker: anonymous registry token, then the manifest list.
for ref in nvidia/tensorrt-llm/release:1.3.0rc29 nvidia/cuda:13.4.1-base-ubuntu24.04 nvidia/cuda:13.0.2-base-ubuntu24.04; do
  repo=${ref%:*} tag=${ref##*:}
  T=$(curl -s "https://nvcr.io/proxy_auth?scope=repository:$repo:pull" | jq -r .token)
  curl -s -H "Authorization: Bearer $T" \
    -H "Accept: application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json" \
    "https://nvcr.io/v2/$repo/manifests/$tag" |
    jq -r --arg ref "$ref" '.manifests[] | "\($ref) \(.platform.os)/\(.platform.architecture) \(.digest)"'
done

# Docker Hub (vLLM, SGLang): the token comes from auth.docker.io.
for ref in vllm/vllm-openai:v0.31.0 lmsysorg/sglang:v0.5.21; do
  repo=${ref%:*} tag=${ref##*:}
  T=$(curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:$repo:pull" | jq -r .token)
  curl -s -H "Authorization: Bearer $T" \
    -H "Accept: application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json" \
    "https://registry-1.docker.io/v2/$repo/manifests/$tag" |
    jq -r --arg ref "$ref" '.manifests[] | select(.platform.os != "unknown") | "\($ref) \(.platform.os)/\(.platform.architecture) \(.digest)"'
done
```

`lmsysorg/sglang`'s index also lists two `unknown/unknown` entries: the
build attestations of the two images, not images to pin, hence the
`select`. The SGLang source commit the image was built from, and the CUDA
version its driver floor comes from, are in the image config of either
platform:

```bash
T=$(curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:lmsysorg/sglang:pull" | jq -r .token)
CFG=$(curl -s -H "Authorization: Bearer $T" -H "Accept: application/vnd.oci.image.manifest.v1+json" \
  https://registry-1.docker.io/v2/lmsysorg/sglang/manifests/sha256:2dbe4c7f53230b09aaa8fa41891c13c51d9d2e253f486a70822aaf08783fff75 |
  jq -r .config.digest)
curl -sL -H "Authorization: Bearer $T" "https://registry-1.docker.io/v2/lmsysorg/sglang/blobs/$CFG" |
  jq -r '.config.Env[] | select(startswith("CUDA_VERSION=") or startswith("SGLANG_BUILD_COMMIT="))'
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
- `ajv` validates `models/embedding.json` against `models/schema.embedding.json`
  (every model is an upstream `gguf` with a `b<build>` tag and an `icon`).
- `.github/scripts/embedding-catalog-check.mjs`: model ids and file paths are
  unique and safe, one `role: "model"` file and at most one `mmproj`, which a
  model has exactly when it reads more than text, `image_max_tokens` fits half
  the context, `matryoshka_dims` shrink below `dims`, and exactly one default.
- `ajv` validates `backends/manifest.json` against `backends/schema.json`.
- Every `llama-*` asset name must carry the declared `tag_name`, and asset
  names must be unique.
- `sha256` and `size` must appear together on an asset, and when
  `download_base` is set every `llama-*` asset must carry a `sha256` — an
  archive we host but do not hash would be downloaded unverified.
- `ajv` validates `backends/llamacpp-upstream-releases.json` against
  `backends/llamacpp-upstream-releases-schema.json`, and
  `.github/scripts/upstream-releases.mjs check` requires releases newest first
  and unique, archive names that carry their release's tag, and a
  `backends/manifest.json` that names an approved release with
  `min_core_version` `0.0.0` and the same hashes.
  `.github/scripts/upstream-verify.test.mjs` checks the approval gates, for
  llama.cpp and sd.cpp, against fixture runs in core.
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
  accept/reject fixtures; the schema's `pattern` holds `descriptor_id` to
  `<engine_id>-<engine version>-r<n>`.
- `ajv` validates `backends/sdcpp-manifest.json` (and
  `backends/sdcpp-manifest.staging.json`, when present) against
  `backends/sdcpp-schema.json`, and `.github/scripts/sdcpp-manifest-check.mjs`
  checks, for both, the tag, unique backend ids and asset names, the required backends,
  the CUDA runtime companion, and `sha256`/`size` pairing.
  `.github/scripts/sdcpp-approve.test.mjs` checks the approval against a
  fixture release: the staged archives must match it by size and digest.
- `ajv` validates `backends/mlx-manifest.json` against
  `backends/mlx-schema.json`, and `node --test` over
  `.github/scripts/mlx-manifest.test.mjs` checks the tag pattern, exactly one
  `macos-arm64` asset with `sha256` and `size`, and an RFC 3339
  `published_at` (ajv ignores `format` here), plus that broken copies fail
  the schema.
- `ajv` validates `backends/foundry-local-manifest.json` against
  `backends/foundry-local-schema.json`, and
  `.github/scripts/foundry-local-manifest-check.mjs` checks unique tags,
  unique platforms and asset names per release, all five platforms in every
  release, and releases ordered newest first by `published_at`.
- `ajv` validates `models/foundry-local-models.json` against
  `models/schema.foundry-local-models.json`, and
  `.github/scripts/foundry-local-models-check.mjs` checks unique model and
  variant ids and assets, unique and safe file paths, at least one variant per
  model, the resolve template's `{region}` and `{asset_id}`, an https
  `catalog.url`, platforms each execution provider runs on, and that a variant
  `context_length` is smaller than its model's.
- Cross-field integrity that the schema cannot express is checked by
  `node --test` over `.github/scripts/inventory-digest.test.mjs` and
  `.github/scripts/runtime-descriptor-integrity.test.mjs`, on every
  descriptor — `engine_id` equals the file name,
  `supported_architectures` and `quantization[].format` are unique,
  every `model_families` key is a `supported_architectures` entry,
  `curated_models` are unique by `repository@revision`,
  `descriptor_id` is `<engine_id>-` followed by exactly `<engine
  version>-r<n>` ([form and order](#descriptor_id-form-and-order)),
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
npx ajv-cli@5 validate -s models/schema.embedding.json -d models/embedding.json --strict=false
node .github/scripts/embedding-catalog-check.mjs
npx ajv-cli@5 validate -s backends/schema.json  -d backends/manifest.json     --strict=false
npx ajv-cli@5 validate -s backends/llamacpp-upstream-releases-schema.json -d backends/llamacpp-upstream-releases.json --strict=false
node .github/scripts/upstream-releases.mjs check
npx ajv-cli@5 validate -s backends/turboquant-schema.json -d backends/turboquant-manifest.json --strict=false
npx ajv-cli@5 validate -s backends/sdcpp-schema.json -d backends/sdcpp-manifest.json --strict=false
npx ajv-cli@5 validate -s backends/mlx-schema.json -d backends/mlx-manifest.json --strict=false
npx ajv-cli@5 validate -s backends/foundry-local-schema.json -d backends/foundry-local-manifest.json --strict=false
node .github/scripts/foundry-local-manifest-check.mjs
npx ajv-cli@5 validate -s models/schema.foundry-local-models.json -d models/foundry-local-models.json --strict=false
node .github/scripts/foundry-local-models-check.mjs
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
