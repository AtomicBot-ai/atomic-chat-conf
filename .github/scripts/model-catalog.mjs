// The only editable model data is models/catalog.json. Legacy files are projections.
import { validateFastflowlm, projectFastflowlm } from './fastflowlm-models.mjs'
export const COLLECTION_FIELDS = {
  audio: 'models', 'atomic-prism-models': 'families', 'staff-picks': 'picks', diffusion: 'families', embedding: 'models', decision: 'models',
  'litert-lm-models': 'models', 'geniex-models': 'models', 'foundry-local-models': 'models',
}
export const COMMIT = /^[0-9a-f]{40}$/
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)

export function validateCatalog(catalog, options) {
  if (!record(catalog) || catalog.schema_version !== 1 || !record(catalog.models) || !record(catalog.collections)) {
    throw new Error('Invalid Atomic Chat model catalog version or structure')
  }
  const checkSources = value => {
    if (Array.isArray(value)) return value.forEach(checkSources)
    if (!record(value)) return
    if (typeof value.repo === 'string' || typeof value.model_name === 'string') {
      if (!COMMIT.test(value.revision ?? '')) throw new Error(`Missing immutable revision for ${value.repo ?? value.model_name}`)
    }
    if (value.revision !== undefined && !COMMIT.test(value.revision)) throw new Error('Invalid model revision')
    Object.values(value).forEach(checkSources)
  }
  const flmVariants = new Set()
  for (const [id, model] of Object.entries(catalog.models)) {
    if (!id || !record(model) || typeof model.kind !== 'string' || typeof model.format !== 'string' || !record(model.variants) || !record(model.definition)) throw new Error(`Invalid model ${id}`)
    checkSources(model.definition)
    if (model.kind === 'fastflowlm') {
      validateFastflowlm(model, options)
      if (flmVariants.has(model.definition.variant_id)) throw new Error('Duplicate FastFlowLM variant_id')
      flmVariants.add(model.definition.variant_id)
    }
    if (model.kind === 'chat' && (!Array.isArray(model.files) || model.files.length === 0)) throw new Error('Missing catalog file plan')
    if (Array.isArray(model.files)) for (const file of model.files) {
      if (!record(file) || typeof file.path !== 'string' || file.path.split(/[\\/]/).some(p => !p || p === '.' || p === '..') || !Number.isSafeInteger(file.size) || file.size < 0 || (file.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(file.sha256))) throw new Error('Invalid catalog file metadata')
    }
  }
  for (const name of ['recommended', ...Object.keys(COLLECTION_FIELDS)]) projectCollection(catalog, name)
  projectFastflowlm(catalog, options)
  return catalog
}

/** Restore the historical wire shape, including which entries did not expose revision. */
export function projectCollection(catalog, name, pinned = false) {
  if (name === 'fastflowlm-models') return projectFastflowlm(catalog)
  const collection = catalog.collections[name]
  if (!record(collection) || !record(collection.header)) throw new Error(`Missing model collection ${name}`)
  const model = (id, variant) => {
    const entry = catalog.models[id]
    if (!entry) throw new Error(`Unknown model reference ${id}`)
    if (typeof variant !== 'string' || !record(entry.variants[variant])) throw new Error(`Unknown model variant ${variant} of ${id}`)
    const expectedKind = name === 'recommended' || name === 'staff-picks' ? 'chat' : name === 'atomic-prism-models' ? 'prism' : name.replace(/-models$/, '')
    if (entry.kind !== expectedKind) throw new Error(`Invalid model kind in ${name}`)
    const data = structuredClone(entry.definition)
    if (!pinned) for (const path of entry.omit_revisions ?? []) {
      const parts = path.split('.')
      const key = parts.pop()
      const parent = parts.reduce((value, part) => value?.[part], data)
      if (parent) delete parent[key]
    }
    return data
  }
  if (name !== 'recommended') {
    if (!Array.isArray(collection.entries)) throw new Error(`Invalid entries of ${name}`)
    return { ...collection.header, [COLLECTION_FIELDS[name]]: collection.entries.map(ref => model(ref.model, ref.variant)) }
  }
  const recommendations = entries => entries.map(({ model: id, variant, projector_variant: projector, ...rest }) => {
    const data = model(id, variant)
    const variants = catalog.models[id].variants
    if (projector !== undefined) model(id, projector)
    return { model_name: data.model_name, ...(pinned ? { revision: data.revision } : {}), ...rest,
      ...(variants[variant].quant ? { quant: variants[variant].quant } : {}),
      ...(projector !== undefined ? { mmproj_quant: variants[projector].quant } : {}),
    }
  })
  return {
    ...collection.header,
    recommendations: recommendations(collection.recommendations),
    ...(collection.low_spec_recommendations ? { low_spec_recommendations: recommendations(collection.low_spec_recommendations) } : {}),
    ...(collection.tiers ? { tiers: Object.fromEntries(Object.entries(collection.tiers).map(([tier, entries]) => [tier, recommendations(entries)])) } : {}),
  }
}
