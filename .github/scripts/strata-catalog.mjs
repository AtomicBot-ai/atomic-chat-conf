import { safePath } from './strata-manifest-check.mjs'

const SHA = /^[a-f0-9]{64}$/, COMMIT = /^[a-f0-9]{40}$/
const recipes = { qwen38: { weights: 2, drafting: 'dflash2', roles: { vision: 'vision', drafter: 'drafter', drafter_config: 'drafter-config', draft_vocab: 'draft-vocab', expert_profile: 'expert-profile' } }, qwen36: { weights: 1, drafting: 'mtp-embedded', roles: { vision: 'vision', drafter_embedded_in: 'weights' } }, deepseek41: { weights: 4, drafting: 'dspark', roles: { vision: 'vision', drafter: 'drafter', engram: 'engram', engram_metadata: 'engram-metadata', expert_profile: 'expert-profile' } } }

const cudaProfiles = {
  'swift-iq2-xs': { family: 'qwen38', drafting: "none" },
  'swift-iq3-xxs': { family: 'qwen38', drafting: "none" },
  'swift-iq3-s': { family: 'qwen38', drafting: "none" },
  'coder-iq1-m': { family: 'qwen38', drafting: "none" },
  'unsloth-ud-iq4-xs-dflash2': { family: 'qwen38', weights: 3 },
  'unsloth-ud-q4-k-xl-dflash2': { family: 'qwen38', weights: 4 },
  'unsloth-ud-q5-k-xl-dflash2': { family: 'qwen38', weights: 6 },
  'unsloth-ud-q6-k-xl-dflash2': { family: 'qwen38', weights: 6 },
  'unsloth-q8-0-dflash2': { family: 'qwen38', weights: 6 },
  'unsloth-ud-iq1-m-dflash2': { family: 'qwen38', weights: 3 },
  'unsloth-ud-q2-0-dflash2': { family: 'qwen38', weights: 3 },
  'unsloth-ud-iq2-xs-dflash2': { family: 'qwen38', weights: 3 },
  'unsloth-ud-q2-k-xl-dflash2': { family: 'qwen38', weights: 4 },
  'unsloth-ud-iq3-xxs-dflash2': { family: 'qwen38', weights: 4 },
  'unsloth-ud-q3-k-xl-dflash2': { family: 'qwen38', weights: 4 },
  'unsloth-ud-iq4-xs-v31-dflash2': { family: 'qwen38', weights: 4 },
  'gyro-s-dflash2': { family: 'qwen38', weights: 1 },
  'gyro-m-dflash2': { family: 'qwen38', weights: 1 },
  'ud-q6-k-xl-mtp': { family: 'qwen36' },
  'q8-0-mtp': { family: 'qwen36' },
  'ista-1-75bpw-dspark': { family: 'deepseek41' },
  'ista-2-25bpw-dspark': { family: 'deepseek41' },
  'unsloth-ud-iq1-s-dspark': { family: 'deepseek41', weights: 4, externalEngram: true },
  'unsloth-ud-iq1-m-dspark': { family: 'deepseek41', weights: 4, externalEngram: true },
  'ista-coder-dspark': { family: 'deepseek41', weights: 5, externalEngram: true },
  'unsloth-ud-q8-k-xl': { family: 'deepseek41', weights: 9, drafting: "none" },
  'nvfp4-gptq': { family: 'qwen38', weights: 1, drafting: "none", readyPack: true },
  'nvfp4-nvidia': { family: 'qwen38', weights: 1, drafting: "none", readyPack: true },
  'nvfp4-qad': { family: 'qwen38', weights: 1, drafting: "none", readyPack: true },
}

const packFiles = [
  'pack/dense.bin',
  'pack/experts.bin',
  'pack/index.txt',
  'pack/native_experts.txt',
  'pack/tokenizer/chat_template.jinja',
  'pack/tokenizer/merges.txt',
  'pack/tokenizer/token_type.json',
  'pack/tokenizer/tokenizer.json',
  'pack/tokenizer/vocab.json',
]

export function validateStrataModel(model, candidate) {
  const d = model.definition, recipe = recipes[d?.family]
  if (!['strata', 'strata-cuda'].includes(model.kind) || model.format !== 'strata' || !recipe || d.preparation_recipe_id !== `strata-${d.family}-v1` || d.preparation_abi !== 'strata-v1') throw new Error('Invalid Strata recipe/format')
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
  const profile = Object.hasOwn(cudaProfiles, d.variant_id) ? cudaProfiles[d.variant_id] : undefined
  if (Boolean(profile) !== (model.kind === 'strata-cuda')) throw new Error('Invalid Strata entry kind')
  if (profile && profile.family !== d.family) throw new Error('Invalid Strata profile family')
  const drafting = profile?.drafting ?? recipe.drafting
  const weightCount = profile?.weights ?? recipe.weights
  const splitCount = weightCount + Number(profile?.externalEngram ?? false)
  const roles = drafting !== 'none'
    ? { ...recipe.roles, ...(profile?.externalEngram ? { engram_metadata: 'weights' } : {}) }
    : profile?.readyPack
      ? { vision: 'vision', ple: 'ple', embedding: 'embedding', expert_profile: 'expert-profile' }
      : d.family === 'qwen38'
        ? { vision: 'vision', expert_profile: 'expert-profile' }
        : { vision: 'vision' }
  const requireFile = (path, role) => {
    if (!files.has(path) || files.get(path).role !== role) throw new Error(`Missing Strata ${role} input: ${path}`)
    referenced.add(path)
  }
  if (!Array.isArray(inputs.weights) || inputs.weights.length !== weightCount || new Set(inputs.weights).size !== weightCount) throw new Error('Missing Strata weight shard')
  for (const path of inputs.weights) requireFile(path, 'weights')
  if (splitCount > 1) {
    const shards = inputs.weights.map(p => /^(.*)-(\d{5})-of-(\d{5})\.gguf$/.exec(p))
    if (shards.some(m => !m || Number(m[3]) !== splitCount) || new Set(shards.map(m => m[1])).size !== 1 || shards.some((m, i) => Number(m[2]) !== i + 1)) throw new Error('Incomplete or mixed Strata shard set')
  }
  if (profile?.externalEngram) {
    const prefix = inputs.weights[0].replace(/-00001-of-\d{5}\.gguf$/, '')
    const final = String(splitCount).padStart(5, '0')
    const engram = d.variant_id === 'ista-coder-dspark' ? 'DeepSeek-V4.1-Flash-Engram-IQ4_NL.gguf' : `${prefix}-${final}-of-${final}.gguf`
    if (inputs.engram !== engram || inputs.engram_metadata !== inputs.weights[0]) throw new Error('Invalid final Engram shard')
  }
  if (profile?.readyPack) {
    if (!Array.isArray(inputs.pack_files) || JSON.stringify([...inputs.pack_files].sort()) !== JSON.stringify(packFiles)) throw new Error('Invalid ready pack')
    for (const path of inputs.pack_files) requireFile(path, 'pack')
  }
  for (const [key, role] of Object.entries(roles)) requireFile(inputs[key], role)
  if (inputs.tokenizer_from !== inputs.weights[0] || inputs.chat_template_from !== inputs.weights[0]) throw new Error('Tokenizer and chat template must come from the pinned first GGUF')
  if (inputs.drafting !== drafting) throw new Error('Incompatible Strata drafter')
  if (d.family === 'deepseek41' && inputs.experts_per_token !== 6) throw new Error('DeepSeek default must preserve all six active experts')
  if (referenced.size !== files.size) throw new Error('Unreferenced Strata input')
  if (d.compatible_variants?.length < 1) throw new Error('No compatible Strata host')
  for (const id of d.compatible_variants ?? []) {
    if (profile && !/-cuda(?:12|13)$/.test(id)) throw new Error('CUDA-only Strata profile')
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

// Keep the expanded profiles outside the collection understood by older Strata readers.
export function projectStrata(catalog, candidate) {
  const seen = new Set(), models = []
  for (const [name, kind] of [['strata-models', 'strata'], ['strata-cuda-models', 'strata-cuda']]) {
    const collection = catalog.collections?.[name]
    if (!collection) continue
    if (collection.header?.schema_version !== 1 || !Array.isArray(collection.entries)) throw new Error('Invalid Strata collection')
    for (const ref of collection.entries) {
      const model = catalog.models[ref.model]
      if (model?.kind !== kind || !model.variants?.[ref.variant] || model.definition.variant_id !== ref.variant || seen.has(ref.model)) throw new Error('Invalid Strata collection reference')
      seen.add(ref.model)
      validateStrataModel(model, candidate)
      models.push(structuredClone(model.definition))
    }
  }
  return { schema_version: 1, models }
}
