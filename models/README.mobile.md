# Mobile model catalogs

`mobile.json` and `mobile-dev.json` are independent, self-contained catalogs for
Atomic Chat Mobile. Both use [`schema.mobile.json`](schema.mobile.json), JSON
Schema Draft-07, with `schema_version: 1`. Desktop clients continue to use their
existing manifests unchanged. No Atomic Chat Desktop or `atomic-chat-core`
changes are needed.

## Addresses

| Purpose | Path | URL after merging to `main` |
| --- | --- | --- |
| Production | `models/mobile.json` | https://raw.githubusercontent.com/AtomicBot-ai/atomic-chat-conf/main/models/mobile.json |
| Development | `models/mobile-dev.json` | https://raw.githubusercontent.com/AtomicBot-ai/atomic-chat-conf/main/models/mobile-dev.json |
| Schema for both | `models/schema.mobile.json` | https://raw.githubusercontent.com/AtomicBot-ai/atomic-chat-conf/main/models/schema.mobile.json |
| Optional editorial metadata source | `models/staff-picks.json` | https://raw.githubusercontent.com/AtomicBot-ai/atomic-chat-conf/main/models/staff-picks.json |

The catalogs are checked in as final JSON. Reading either mobile catalog never
requires another request to staff picks, a desktop recommendation tier, or a
generation step. The mobile app agent owns fetching, version handling, cache,
fallback, runtime availability checks and switching its URLs.

## Format

```json
{
  "$schema": "./schema.mobile.json",
  "schema_version": 1,
  "updated_at": "2026-10-21T00:00:00Z",
  "models": [
    {
      "id": "LiquidAI/LFM2-700M-GGUF/LFM2-700M-Q4_K_M.gguf",
      "name": "LFM 2 (700M)",
      "description": "Hybrid model for fast everyday chat and lightweight tasks. Onboarding default.",
      "iconUrl": "liquid",
      "engine": "llama",
      "size": 468624320,
      "mmprojRemoteId": null,
      "badges": [{ "label": "fast", "tone": "green" }],
      "isOnboarding": true
    }
  ]
}
```

`$schema` is optional editor assistance. The other three container fields are
required. `updated_at` is a real UTC date-time ending in `Z`, with optional
millisecond precision (one to three fractional digits); refresh it on every
catalog edit. Breaking changes require a new mobile schema version and a client
that supports it before publication. A bare array and the old top-level
`onboardingModelIds` are not part of this contract.

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Exact, case-sensitive Hugging Face identity. For `llama`, `owner/repo/path/to/file.gguf`; for `mlx`, a mobile MLX repository or artifact; for `coreml-diffusion`, a CoreML repository or exact ZIP artifact. |
| `name` | yes | Non-empty card title. |
| `description` | yes | Non-empty card description, materialized in the mobile catalog. |
| `iconUrl` | yes | Mobile bundled asset key or HTTPS image URL. No desktop asset handles or numeric React Native `require()` values. |
| `engine` | yes | Exactly `llama`, `mlx` or `coreml-diffusion`. Apple Intelligence is injected by the app and must never be published here. |
| `size` | yes | Positive integer download size in bytes, at most JavaScript's safe integer limit. Not RAM/VRAM or an inference memory estimate. |
| `mmprojRemoteId` | yes | Exact GGUF projector file identity, or `null`. Must differ from `id`. |
| `mmprojSize` | when projector exists | Positive integer projector size in bytes. Must be absent when `mmprojRemoteId` is `null`. |
| `badges` | yes | Array of `{ "label": "...", "tone": "..." }`; may be empty. `label` is non-empty; optional `tone` is `purple`, `green`, `orange`, `gray` or `blue`. |
| `categories` | no | Descriptive categories: `general`, `reasoning`, `coding`, `vision`, `audio`, `tools`, `compact`, `multilingual`. Unique values; no inference of runtime features. |
| `platforms` | no, except Apple engines | Non-empty, unique array of `ios`/`android`. Omission means both. `mlx` and `coreml-diffusion` require exactly `["ios"]`; the app must also check runtime availability. |
| `isOnboarding` | no | Offer this exact artifact in mobile onboarding only when `true`. Array order defines catalog order; there is no desktop onboarding inheritance. |
| `forceCpu` | no | Explicit mobile execution flag. Omission means no forced CPU override; preserve `false` when supplied. |
| `supportsThinking` | no | Show the mobile thinking toggle only when explicitly `true` and supported by this artifact's chat template. Omission/`false` does not enable it. |

All other fields are rejected, including `path`, `status`, `progress`,
`mmprojLocalPath` and admin audit fields `createdAt`/`updatedAt`. Keep audit data
in the admin system; the public catalog has one `updated_at`. Remote ids use
`owner/repo[/artifact]` path segments containing letters, digits, `_`, `-`, `.`;
empty, `.` and `..` segments, URLs, query strings and fragments are forbidden.
Models must have unique `id` values within each catalog; the same `id` may have
different metadata and flags in dev and production. An empty dev catalog is
valid; neither catalog is required to have onboarding entries.

Model ids are also local download identities. Never normalize casing, rename a
file, substitute another quantization or replace an id with a repo-only id.
Changing weights requires a new artifact identity. Projectors and their sizes
are configured explicitly for the chosen artifact. Mobile CoreML repositories
and ZIPs are independent of desktop `models/diffusion.json` (`sdcpp`/`diffusers`).

## Reusing staff-picks metadata

Reuse is **copy on edit**, with mobile values taking precedence. There is no
runtime join, implicit fallback or automatic synchronization. The admin editor
may offer an explicit import of these four metadata fields from a staff pick,
then write their final values into the mobile JSON:

| Staff-picks field | Mobile field | Rule |
| --- | --- | --- |
| `title` | `name` | Copy only when present and explicitly selected by the editor. Retain the mobile title otherwise. |
| `summary` | `description` | Copy only when present and selected. `description_key` is a desktop localization key, not mobile text. |
| `icon` | `iconUrl` | Resolve through a mobile asset mapping or an explicit HTTPS URL. Never blindly copy the desktop key. |
| `categories` | `categories` | Copy the descriptive array when selected. It does not create badges or execution flags. |

Match a candidate by the **exact** `model_name` (`owner/repo`), compared with the
first two segments of the mobile `id`; the editor must confirm the exact model
and variant. Do not match by family, display name or a similar repository name.
If there is no exact pick, keep all mobile metadata explicit. Mobile descriptions
and titles may intentionally differ. Changes to a pick never overwrite an
existing mobile value without a subsequent explicit edit and review.

For the migrated set, the exact shared repositories are
`LiquidAI/LFM2.5-2.6B-GGUF` and `prism-ml/Bonsai-27B-gguf`. Their desktop icon
keys map to existing mobile keys as follows: `lfm` → `liquid`, `prism` → `bonsai`.
Other currently bundled mobile keys include `qwen`, `google`, `huggingface`,
`dreamshaper`, `realisticVision`, `custom`; confirm availability in the target
mobile release before publishing a new key. Unknown desktop keys require an
explicit mobile asset or HTTPS URL. The migration keeps all existing card text
and icons; it does not copy desktop categories into existing records.

Everything else is mobile-owned: `id`, `engine`, `size`, projectors, `badges`,
`platforms`, `isOnboarding`, `forceCpu`, `supportsThinking`, order and inclusion
in the catalog. Never inherit desktop `platforms`, `format`, `active`, `order`,
onboarding, RAM/VRAM tiers or recommendation status. In particular, `reasoning`
does not prove a template supports the mobile thinking toggle, and `vision`
does not select a projector. Shared metadata must not change the schema, version,
records or platform values of any existing desktop manifest. A broader common
contract requires a separate task.

## Migration provenance

Both files were imported from
[`AtomicBot-ai/atomic-chat-mobile-data` at `43a3ff3d4256272fc58af783d6ac4a7917e46022`](https://github.com/AtomicBot-ai/atomic-chat-mobile-data/tree/43a3ff3d4256272fc58af783d6ac4a7917e46022):

- `models.json` → `models/mobile.json`: 18 models, including two CoreML entries
  and three onboarding models.
- `dev-models.json` → `models/mobile-dev.json`: one model, with its existing dev
  description and `supportsThinking: false` preserved. Dev is not a production
  copy and has no onboarding entries.

The only entry fields removed were admin audit timestamps `createdAt` and
`updatedAt`. All remaining values and model order were preserved. The new
container adds `$schema`, `schema_version` and `updated_at`. This import does not
switch any deployed app, admin service or legacy endpoint.

## Switching the admin and keeping one source of truth

The current admin publishes bare arrays in `atomic-chat-mobile-data`; the mobile
app fetches those same paths. The admin implementation is outside this repo.
Apply these changes in its owning project as part of the mobile rollout:

1. Before cutover, pause catalog edits and compare both legacy files with the
   pinned import above. Reimport any intervening edits without changing ids,
   artifacts, projectors or flags, then validate the result.
2. Configure **both reads and writes**, including the dev toggle, to use GitHub
   owner `AtomicBot-ai`, repo `atomic-chat-conf`, branch `main`. Production maps
   to `models/mobile.json`; dev maps to `models/mobile-dev.json`. Grant the
   admin's server-side GitHub credentials access to this repository. Never
   include credentials in the catalogs or mobile app.
3. Adapt the editor to read the container and edit `catalog.models`. On save,
   serialize the full container, keep `schema_version: 1`, refresh `updated_at`
   and preserve optional supported fields, explicit `false` values and order.
   Keep admin audit fields out of the serialized records. Do not save a bare
   array, send local download state or discard `categories` on a round trip.
4. Validate against `models/schema.mobile.json` before submitting a change and
   run the integrity checks below. Use the target file's current GitHub content
   SHA for conflict detection; stale writes must reload or merge, not overwrite
   another editor. Submit a branch/PR to this repository so CI gates the merge.
   `main` remains the source read by the app and admin after publication.
5. Edit and test in dev first. Promote only the reviewed entries or field
   changes into production in a separate PR. Never replace the production
   catalog with the one-entry dev list.
6. The mobile app agent switches production/dev fetches to the corresponding
   conf URLs and implements its version, cache and fallback behavior. Verify
   the admin's post-save read and each app mode read the same merged revision.
7. Already released mobile apps still read the old URLs. Before resuming edits,
   arrange a **one-way compatibility export** after every conf publication:
   `mobile.json.models` → `atomic-chat-mobile-data/main/models.json` and
   `mobile-dev.json.models` → `atomic-chat-mobile-data/main/dev-models.json`.
   Publish bare arrays there and verify equality with the corresponding conf
   `models` arrays. For example, `jq '.models' models/mobile.json` produces the
   legacy production payload. The export belongs to the admin/release service;
   this repository does not write to another repository. Keep legacy endpoints
   available and current for supported released clients. Disable independent
   legacy editing, monitor/retry failed exports and consider publication
   incomplete until both paths agree. Never maintain two independently edited
   catalogs.

The cutover is complete only when the admin reads/writes conf, new app modes
read conf, and the old endpoints are verified compatibility copies. To roll
back a catalog edit, revert its PR and refresh `updated_at`; publish its legacy
export as well. A transport cutover rollback must move admin reads and writes
together and continue using the same authoritative data.

## Validation

From the repository root:

```bash
npx --yes ajv-cli@5 validate -s models/schema.mobile.json -d 'models/mobile*.json' --strict=false
node .github/scripts/mobile-catalog-check.mjs
node --test .github/scripts/mobile-catalog.test.mjs
make validate
```

CI runs these mobile schema, integrity and rejection tests alongside the
existing conf checks. The integrity gate checks unique ids, valid UTC dates,
safe artifact paths, concrete GGUF models/projectors and CoreML artifacts.
The schema rejects local state, unknown fields, unsupported engines/platforms,
invalid sizes, unpaired projectors and non-iOS Apple-engine entries. Rejection
tests exercise these failures; categories never derive mobile execution flags.
