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
