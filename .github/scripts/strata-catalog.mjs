import { safePath } from './strata-manifest-check.mjs'

const SHA = /^[a-f0-9]{64}$/, COMMIT = /^[a-f0-9]{40}$/
const recipes = { qwen38: { weights: 2, drafting: 'dflash2', roles: { vision: 'vision', drafter: 'drafter', drafter_config: 'drafter-config', draft_vocab: 'draft-vocab', expert_profile: 'expert-profile' } }, qwen36: { weights: 1, drafting: 'mtp-embedded', roles: { vision: 'vision', drafter_embedded_in: 'weights' } }, deepseek41: { weights: 4, drafting: 'dspark', roles: { vision: 'vision', drafter: 'drafter', engram: 'engram', engram_metadata: 'engram-metadata', expert_profile: 'expert-profile' } } }

export function validateStrataModel(model, candidate) {
  const d = model.definition, recipe = recipes[d?.family]
  if (model.kind !== 'strata' || model.format !== 'strata' || !recipe || d.preparation_recipe_id !== `strata-${d.family}-v1` || d.preparation_abi !== 'strata-v1') throw new Error('Invalid Strata recipe/format')
  if (!model.variants?.[d.variant_id]) throw new Error('Missing Strata variant')
  const sources = new Map(), files = new Map(), paths = new Set()
  for (const s of d.sources ?? []) {
    if (sources.has(s.id) || !COMMIT.test(s.revision) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s.repo) || s.repo.split('/').some(p => ['.', '..'].includes(p)) || !['huggingface', 'github'].includes(s.host)) throw new Error('Invalid immutable Strata source')
    sources.set(s.id, s)
  }
  let bytes = 0
  for (const f of d.files ?? []) {
    if (!safePath(f.path) || !safePath(f.source_path) || paths.has(f.path.toLowerCase()) || !sources.has(f.source) || !SHA.test(f.sha256) || !Number.isSafeInteger(f.size) || f.size <= 0) throw new Error('Invalid Strata file plan: path, source, size or SHA-256')
    paths.add(f.path.toLowerCase()); files.set(f.path, f); bytes += f.size
  }
  if (!Number.isSafeInteger(bytes) || d.requirements?.download_bytes !== bytes) throw new Error('Strata download size differs from file plan')
  const inputs = d.inputs ?? {}, referenced = new Set()
  const requireFile = (path, role) => {
    if (!files.has(path) || files.get(path).role !== role) throw new Error(`Missing Strata ${role} input: ${path}`)
    referenced.add(path)
  }
  if (!Array.isArray(inputs.weights) || inputs.weights.length !== recipe.weights || new Set(inputs.weights).size !== recipe.weights) throw new Error('Missing Strata weight shard')
  for (const path of inputs.weights) requireFile(path, 'weights')
  if (recipe.weights > 1) {
    const shards = inputs.weights.map(p => /^(.*)-(\d{5})-of-(\d{5})\.gguf$/.exec(p))
    if (shards.some(m => !m || Number(m[3]) !== recipe.weights) || new Set(shards.map(m => m[1])).size !== 1 || shards.some((m, i) => Number(m[2]) !== i + 1)) throw new Error('Incomplete or mixed Strata shard set')
  }
  for (const [key, role] of Object.entries(recipe.roles)) requireFile(inputs[key], role)
  if (inputs.tokenizer_from !== inputs.weights[0] || inputs.chat_template_from !== inputs.weights[0]) throw new Error('Tokenizer and chat template must come from the pinned first GGUF')
  if (inputs.drafting !== recipe.drafting) throw new Error('Incompatible Strata drafter')
  if (d.family === 'deepseek41' && inputs.experts_per_token !== 6) throw new Error('DeepSeek default must preserve all six active experts')
  if (referenced.size !== files.size) throw new Error('Unreferenced Strata input')
  if (d.compatible_variants?.length < 1) throw new Error('No compatible Strata host')
  for (const id of d.compatible_variants ?? []) {
    if (d.family === 'qwen36' && /metal|sycl|spark/.test(id)) throw new Error('Qwen3.6 does not support Metal/SYCL/Spark')
    if (d.family === 'deepseek41' && /sycl|cuda12/.test(id)) throw new Error('DeepSeek does not support SYCL/CUDA12')
    if (candidate) {
      const variant = candidate.variants.find(v => v.id === id)
      if (!variant?.families.includes(d.family)) throw new Error(`Incompatible Strata variant: ${id}`)
    }
  }
  if (candidate && (d.engine_release !== candidate.release_id || d.preparation_abi !== candidate.preparation_abi)) throw new Error('Strata model/build contract differs')
  if (d.qualification?.status !== 'upstream-supported' && d.qualification?.status !== 'atomic-qualified') throw new Error('Missing Strata qualification')
  if (!d.qualification.evidence?.length) throw new Error('Missing Strata evidence')
  return model
}

/** Optional collection: old catalogs are valid and produce an empty Strata shelf. */
export function projectStrata(catalog, candidate) {
  const collection = catalog.collections?.['strata-models']
  if (!collection) return { schema_version: 1, models: [] }
  if (collection.header?.schema_version !== 1 || !Array.isArray(collection.entries)) throw new Error('Invalid Strata collection')
  const seen = new Set()
  return { ...collection.header, models: collection.entries.map(ref => {
    const model = catalog.models[ref.model]
    if (!model || !model.variants?.[ref.variant] || model.definition.variant_id !== ref.variant || seen.has(ref.model)) throw new Error('Invalid Strata collection reference')
    seen.add(ref.model)
    validateStrataModel(model, candidate)
    return structuredClone(model.definition)
  }) }
}
