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

`sources` contains independent `{id, repo, revision}` Hugging Face sources,
each pinned to a full commit. Each `files` entry has `source`, `source_path`,
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
The first production collection is empty pending core qualification.

Use the [FastFlowLM consumer fixtures](../.github/fixtures/fastflowlm/README.md)
to develop against unreleased conf. They include real model pins, two independent
sources, small-file evidence and a pinned copy of the pre-FLM core parser.

The legacy `refresh-model-catalog.mjs` deliberately refuses FLM entries: repinning
one source without rebuilding its full file plan would keep stale hashes and
invalid qualification evidence. Stage and requalify a complete FLM definition
when any source changes.
