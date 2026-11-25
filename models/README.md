# Model catalog ownership

`catalog.json` is the only editable desktop model catalog. Its `models` entries own sources and full HF commits; `collections` reference model and variant IDs.

The following files are **deprecated generated compatibility exports**, retained for released clients:

- `audio.json` — generated; do not edit independently.
- `recommended.json` — generated; do not edit independently.
- `staff-picks.json` — generated; do not edit independently.
- `diffusion.json` — generated; do not edit independently.
- `embedding.json` — generated; do not edit independently.
- `decision.json` — generated; do not edit independently.
- `litert-lm-models.json` — generated; do not edit independently.
- `geniex-models.json` — generated; do not edit independently.
- `foundry-local-models.json` — generated; do not edit independently.
- `atomic-prism-models.json` — generated; do not edit independently.

Their schemas carry `deprecated: true` as an editor annotation. The data files retain their original fields and `schema_version`: adding a deprecation field to those strict legacy payloads would break older readers.

Edit `catalog.json`, update selected HF metadata with `.github/scripts/refresh-model-catalog.mjs` when needed, then run `node .github/scripts/export-model-catalog.mjs` from the repository root. Run `make validate`; it checks semantic equality offline. Client bundled copies are generated with the same command's `--baseline` option.

Deprecation ends independent authoring, not client support. Do not remove exports or stop generating them until a separate change explicitly ends support for every consumer. The core's Prism compatibility reader still consumes its generated export.

Mobile catalogs and versioned engine/runtime descriptors retain their own supported contracts.


## FastFlowLM contract

`fastflowlm-models` is an optional collection in `catalog.json`, with
`header.schema_version: 1` and `entries: [{model, variant}]`. Its absence in an
older cache means an empty collection. There is no separate FLM compatibility
export. Existing export payloads and their URLs remain unchanged.

An entry has `kind: fastflowlm`, `format: fastflowlm` and one stable variant key
matching `definition.variant_id`. The definition contains `model_id`,
`variant_id`, `checkpoint` (native FLM tag), `minimum_flm_version` (Atomic build
ID, e.g. `flm-1.0.11-r1`), `local_only_protocol: 1`, `npu_generation: xdna2`,
context, license, gated status and explicit chat/tools/reasoning/structured-output
capabilities. A stock upstream version never proves local-only support.

Each source contains `{id, repo, revision}` pinned to a full commit. The optional
`host` is `huggingface` (default) or `github`. Resolve a Hugging Face file at
`https://huggingface.co/<repo>/resolve/<revision>/<source_path>` and a public GitHub
file at `https://raw.githubusercontent.com/<repo>/<revision>/<source_path>`.
Send HF credentials only to the allowed Hugging Face origin. GitHub files are anonymous. Each `files` entry has `source`, `source_path`,
local relative `path`, positive `size` and SHA-256. Small Git files need a hash
of their **contents**, not their Git blob SHA-1. The separate `components`
inventory names all weights, tokenizer, config, chat-template, kernels and
metadata paths; every reference must resolve to a file and every file must be
accounted for. A chat template embedded in tokenizer config references that
same file. Empty `kernels` is allowed only when the engine provides everything
needed; core qualification must prove that choice. Paths reject traversal,
Windows reserved names, case collisions and file/directory collisions.

Production definitions require `qualification.status: qualified` and HTTPS
live evidence. `candidate` entries are accepted only by explicit test/staging
validation and are never exported or offered in the production catalog.
Capabilities in a candidate are targets for validation, not certified claims.
The first qualified entry is `qwen3-0.6b-npu2`, using `flm-1.0.11-r2` with core
0.22.0 or newer. Its twelve-file plan retains the tested source commits and
hashes, including four kernels from the pinned FLM source tree. Only chat is
qualified; tools, reasoning and structured output remain false. The linked
acceptance report covers context 2048 on existing-driver Windows 11 and manual
Arch installations. Production limits the context to those tested 2048 tokens;
the staging candidate retains the upstream 32768-token target. It does not qualify automatic driver installation, service
accounts or the other staged models.

Use the [FastFlowLM consumer fixtures](../.github/fixtures/fastflowlm/README.md)
to develop against unreleased conf. They include real model pins, independent pinned
sources, small-file evidence and a pinned copy of the pre-FLM core parser.

The legacy `refresh-model-catalog.mjs` deliberately refuses FLM entries: repinning
one source without rebuilding its full file plan would keep stale hashes and
invalid qualification evidence. Stage and requalify a complete FLM definition
when any source changes.


### FastFlowLM upstream catalog

`fastflowlm-models` contains all 44 XDNA2 chat checkpoints in the shipped FLM source revision.
Ten entries have `definition.recommended: true`; all others remain available. Recommendations
are editorial and independent of hardware qualification. `qualification.status: upstream`
records upstream provenance; only `qualified` means Atomic's hardware acceptance passed.
Existing GGUF/MLX recommendation exports are unchanged.

Regenerate complete pinned file plans and matching core native profiles with:

```sh
python3 .github/scripts/import-fastflowlm.py /path/to/FastFlowLM ../atomic-chat-core
make validate
```

The importer reads the engine manifest's exact source commit, retains existing recommendations
and qualified entries, hashes small files and uses immutable Hub LFS hashes for weights.
It caches fetched data under `/tmp/atomic-flm-catalog-import-cache`; remove that disposable
cache before intentionally refreshing moving Hub branches. A failure aborts catalog writes.
Deploy the matching core before using the new upstream entries. No model weights are fetched
by this maintenance script. Standalone embeddings, decision/transcription models and models
for other NPU platforms are outside the current chat adapter.

## Strata contract

The optional `strata-models` collection references six `kind/format: strata`
entries. The additional `strata-cuda-models` collection references 29
`kind: strata-cuda`, `format: strata` profiles, including three NVFP4 packs.
Older Strata readers retain the original collection without interpreting new
profile shapes. These collections live only in `catalog.json`; no standalone
Strata model export is generated. The
released core 0.21.2 reader ignores this unknown kind/collection, and the new
conf reader returns an empty Strata collection when it is absent. A pinned
snapshot protects every existing export and the pre-Strata catalog records.

The initial recipes are Qwen3.8 IQ3_XXS with DFlash2, Qwen3.6 UD-Q4_K_XL with
embedded MTP, and DeepSeek V4.1 2.00 bpw with DSpark and six active experts.
Sources use immutable repository revisions. `source_path` locates the upstream
file; `path` is the safe relative installation path. Every file has an exact size,
SHA-256 and role. The plan includes shards, vision, draft/config/vocabulary,
expert profiles and DeepSeek Engram metadata as required. Tokenizer and chat
template come from the first pinned GGUF, rather than floating separate files.
Evidence comes from immutable Hub LFS metadata and hashes of small source files;
weights have not been downloaded or run by this change.

`engine_release`, `preparation_abi` and `preparation_recipe_id` must agree with
the core adapter and selected engine. Recipe ids select audited local core code,
never arbitrary commands from catalog data. `compatible_variants` is an allowlist:
Qwen3.6 excludes Metal/SYCL/Spark; DeepSeek excludes SYCL/CUDA12 and restricts AMD
to the specified device families. Availability of a binary does not qualify a GPU.

`requirements.download_bytes` is the exact sum of all source files. Disk accounting
also includes derivatives, temporary work and the previous installation. RAM and
VRAM are separate on discrete GPUs; unified memory is counted once. The pinned
`resource_estimator` recipe in core calculates actual RAM/VRAM/disk bounds using
the selected settings and hardware; `requires_core_check` prohibits treating
download size as an install or load eligibility check. No guessed memory minima
are provided. Qwen3.6 does not offer the SSD memory mode.

Capabilities describe the recipe's upstream support and prerequisites (including
the full JSON validator, verified draft/profile inputs and vision reader), not
successful Atomic acceptance. All 35 profiles are marked `upstream-supported`.
Promotion to `atomic-qualified` requires evidence for the exact bundle, model
and backend. Assign a real core version and qualify the runtime before offering
these candidate definitions as installable models.

### Add a model using an existing Strata profile

Copy the matching descriptor and use kind `strata-profile` in the optional
`strata-profile-models` collection. Give each quantization a unique
`variant_id` and set `definition.profile_id` to the original profile's
variant ID. Use the new ID in the variant map and collection reference.
Pin the weights and auxiliary files independently, record their file evidence,
and sum all file sizes in `requirements.download_bytes`. Keep the family's
preparation contract and use a subset of the original profile's supported hosts.

The three AtomicChat DeepSeek Uncensored entries show this format. Their weights
come from AtomicChat and their shared Engram comes from ISTA-DASLab. The Hub
groups their quantizations by the repository supplying the first weight shard.
Clients through core 0.24.4 ignore the optional collection. A new converter,
file layout, or hardware capability requires matching engine support.

## Desktop DSpark GGUF heads

Use an `auxiliary` entry with `definition.method = "dspark"`. The definition identifies the exact target checkpoint, a reference target file by SHA-256 and size, and the draft repository, pinned revision and quantization. The optional `target_repo` identifies the GGUF conversion repository for offline search. The file plan pins each draft by size and SHA-256, including mainline GGUF files published with a `.gguf_file` suffix. A draft can be installed independently of the target. The first two pairs were exercised against upstream b12722 on macOS arm64.
