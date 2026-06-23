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
  recommended.json   # Recommended models surfaced in Hub + onboarding
  schema.json        # JSON Schema (Draft-07) for the recommended-models manifest
backends/
  manifest.json            # llama.cpp backend catalog (mirrors a ggml-org release)
  schema.json              # JSON Schema (Draft-07) for the backends manifest
  turboquant-manifest.json # TurboQuant backend catalog (one tag per variant)
  turboquant-schema.json   # JSON Schema (Draft-07) for the TurboQuant manifest
.github/workflows/
  validate.yml       # Validates every manifest on every PR
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

## llama.cpp backends manifest

[`backends/manifest.json`](backends/manifest.json) is the catalog of
downloadable `llama.cpp` backend builds the Atomic Chat client offers on
**Windows and Linux x64**. It exists to dodge GitHub's unauthenticated API
rate limit (60 req/hr/IP): the client used to resolve the backend list
straight from `api.github.com/repos/ggml-org/llama.cpp/releases/latest`,
which dead-ended on shared / NAT / VPN networks (see ATO-199). It now reads
this static file via `raw.githubusercontent.com`, which has no per-IP limit.

The file **mirrors the shape of a GitHub release JSON** (`tag_name` +
`assets[].name`) so the client reuses its existing asset-name parser
verbatim — only the source URL changed. The backend **archives themselves**
are still downloaded from the ggml-org CDN
(`github.com/ggml-org/llama.cpp/releases/download`); this manifest is only
the index of *what exists*.

```json
{
  "$schema": "./schema.json",
  "updated_at": "2026-06-17T00:00:00Z",
  "tag_name": "b9691",
  "assets": [
    { "name": "llama-b9691-bin-win-cpu-x64.zip" },
    { "name": "llama-b9691-bin-win-cuda-12.4-x64.zip" },
    { "name": "llama-b9691-bin-win-cuda-13.3-x64.zip" },
    { "name": "llama-b9691-bin-win-vulkan-x64.zip" },
    { "name": "llama-b9691-bin-ubuntu-x64.tar.gz" },
    { "name": "llama-b9691-bin-ubuntu-vulkan-x64.tar.gz" },
    { "name": "cudart-llama-bin-win-cuda-12.4-x64.zip" },
    { "name": "cudart-llama-bin-win-cuda-13.3-x64.zip" }
  ]
}
```

- `$schema` / `updated_at` are advisory; the client reads only `tag_name`
  and `assets[].name`, so the GitHub-mirror shape is preserved.
- Only Windows/Linux x64 assets are listed. **macOS is bundled-only** and is
  never resolved from this manifest, so macOS assets are intentionally
  omitted.
- The `cudart-*` companions are listed for completeness; the client's
  backend regex ignores them (it matches only `llama-<tag>-bin-...`), so
  they are harmless.

### How to update the backends manifest

> The manifest is **static and hand-maintained** for now. Automated
> generation from the ggml-org release stream is a planned follow-up.

1. Pick the newest **complete** ggml-org release — one that has finished
   uploading *all* whitelisted assets (`win-cpu-x64`, `win-cuda-12.4-x64`,
   `win-cuda-13.x-x64`, `win-vulkan-x64`, `ubuntu-x64`, `ubuntu-vulkan-x64`,
   plus the two `cudart-*` companions). Releases publish their tag before
   every asset finishes uploading, so do not blindly grab `latest`.
2. Edit [`backends/manifest.json`](backends/manifest.json): set `tag_name`
   to the new tag, rewrite each `assets[].name` to carry that tag, and bump
   `updated_at`.
3. Commit to a branch, open a PR, wait for CI ("Validate registry") to pass,
   get a review, merge. All clients pick up the change within an hour.

## TurboQuant backends manifest

[`backends/turboquant-manifest.json`](backends/turboquant-manifest.json) is
the catalog of downloadable **TurboQuant** `llama.cpp` builds
(`AtomicBot-ai/atomic-llama-cpp-turboquant`) the Atomic Chat client offers as
a *second* provider on **Windows and Linux x64** (alongside the upstream
provider above). It exists for the same rate-limit reason as the upstream
manifest, with one twist: TurboQuant ships **each variant in its own
release** (every variant on the same SHA but a different tag), so a
`/releases/latest` lookup is useless and a `/releases` scan would hammer
`api.github.com`. Therefore **every backend entry carries its own `tag`**.

```json
{
  "$schema": "./turboquant-schema.json",
  "updated_at": "2026-06-23T00:00:00Z",
  "commit": "d86eb0b",
  "backends": [
    { "id": "windows-x64-cpu",       "tag": "turboquant-windows-x64-cpu-d86eb0b",       "asset": "llama-turboquant-windows-x64-cpu.zip" },
    { "id": "windows-x64-cuda-12.4", "tag": "turboquant-windows-x64-cuda-12.4-d86eb0b", "asset": "llama-turboquant-windows-x64-cuda-12.4.zip" },
    { "id": "windows-x64-cuda-13.3", "tag": "turboquant-windows-x64-cuda-13.3-d86eb0b", "asset": "llama-turboquant-windows-x64-cuda-13.3.zip" },
    { "id": "windows-x64-vulkan",    "tag": "turboquant-windows-x64-vulkan-d86eb0b",    "asset": "llama-turboquant-windows-x64-vulkan.zip" },
    { "id": "linux-x64-vulkan",      "tag": "turboquant-linux-x64-vulkan-d86eb0b",      "asset": "llama-turboquant-linux-x64-vulkan.tar.gz" }
  ]
}
```

- `id` is the clean, release-aligned backend id the client uses verbatim.
- `tag` must start `turboquant-<id>`; the archive download URL is built as
  `…/releases/download/<tag>/<asset>` against the releases CDN (not rate-limited).
- `asset` must be `llama-turboquant-<id>.zip` (Windows) or
  `llama-turboquant-<id>.tar.gz` (Linux). Windows CUDA archives **bundle**
  `cudart64`/`cublas64`/`cublasLt64` — no separate cudart download.
- **macOS is bundled-only** and intentionally omitted (`macos-arm64` is never
  resolved from this manifest).

### How to update the TurboQuant manifest

> Also static and hand-maintained. Pick the new SHA's release set, then for
> each `backends[]` entry set `tag` to `turboquant-<id>-<sha>`, keep `asset`
> as `llama-turboquant-<id>.{zip,tar.gz}`, bump `commit` + `updated_at`,
> open a PR, and merge once CI is green.

## CI validation

[`.github/workflows/validate.yml`](.github/workflows/validate.yml) runs on
every push and pull request. It performs the following checks:

- `ajv` validates `providers/registry.json` against `providers/schema.json`.
- Every `provider` id must be unique.
- The job fails if any `api_key` field is non-empty.
- `ajv` validates `models/recommended.json` against `models/schema.json`.
- Every `(model_name, description_key)` pair in the recommended-models
  manifest must be unique.
- `ajv` validates `backends/manifest.json` against `backends/schema.json`.
- Every `llama-*` asset name must carry the declared `tag_name`, and asset
  names must be unique.
- `ajv` validates `backends/turboquant-manifest.json` against
  `backends/turboquant-schema.json`.
- Every TurboQuant `tag` must start `turboquant-<id>`, every `asset` must be
  `llama-turboquant-<id>.{zip,tar.gz}`, and backend ids must be unique.

You cannot merge a PR until CI is green.

## Local validation

If you want to validate locally before pushing:

```bash
npx ajv-cli@5 validate -s providers/schema.json -d providers/registry.json --strict=false
npx ajv-cli@5 validate -s models/schema.json    -d models/recommended.json   --strict=false
npx ajv-cli@5 validate -s backends/schema.json  -d backends/manifest.json     --strict=false
npx ajv-cli@5 validate -s backends/turboquant-schema.json -d backends/turboquant-manifest.json --strict=false
```

## Security

- API keys must never appear in this repository.
- The registry is served via HTTPS from `raw.githubusercontent.com`.
- Atomic Chat clients ignore the `api_key` field even if a malicious commit slips
  through; user-supplied keys live only in the local OS keychain.

## License

See the project's primary license in the main Atomic Chat repository.
