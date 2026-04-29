# Atomic Chat — Configuration Registry

This repository hosts **runtime configuration** consumed by the Atomic Chat (Jan)
desktop client. The client fetches the manifest at startup and refreshes it
periodically, so changes here propagate to all installed Jan clients (macOS,
Windows, Linux) without an application release.

> **TL;DR for non-developers** — to add a new model or provider, edit
> [`providers/registry.json`](providers/registry.json) on GitHub, open a Pull
> Request, get it reviewed, merge it. All running Jan clients will pick up the
> change within an hour.

---

## Repository layout

```
providers/
  registry.json      # Single source of truth for cloud providers
  schema.json        # JSON Schema (Draft-07) used by CI validation
.github/workflows/
  validate.yml       # Validates registry.json on every PR
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

## How a Jan client uses the registry

```
raw.githubusercontent.com/AtomicBot-ai/atomic-chat-conf/main/providers/registry.json
                              │
                              ▼ fetched once per hour (TTL = 1h)
                ┌───────────────────────────┐
                │  Jan client (web-app)     │
                │  - validates schema_version│
                │  - merges with `azure`    │
                │  - caches in localStorage │
                └───────────────────────────┘
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

Every manifest carries a top-level `schema_version`. The Jan client embeds
its highest supported version. If you ship a manifest whose `schema_version`
exceeds what older clients understand, they will fall back to their cached or
baseline manifest and prompt the user to update Jan.

**Bump `schema_version` only when adding new required fields or changing the
shape of existing fields in a backwards-incompatible way.** Adding a new
provider or new model never requires a bump.

## CI validation

[`.github/workflows/validate.yml`](.github/workflows/validate.yml) runs on
every push and pull request:

- `ajv` validates `providers/registry.json` against `providers/schema.json`.
- The job ensures every `provider` id is unique.
- The job fails if any `api_key` field is non-empty.

You cannot merge a PR until CI is green.

## Local validation

If you want to validate locally before pushing:

```bash
npx ajv-cli@5 validate -s providers/schema.json -d providers/registry.json --strict=false
```

## Security

- API keys must never appear in this repository.
- The registry is served via HTTPS from `raw.githubusercontent.com`.
- Jan clients ignore the `api_key` field even if a malicious commit slips
  through; user-supplied keys live only in the local OS keychain.

## License

See the project's primary license in the main Atomic Chat repository.
