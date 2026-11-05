const object = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const id = /^[a-z0-9][a-z0-9._-]*$/
const hash = /^[0-9a-f]{64}$/
export function safeModelPath(path) {
  return typeof path === 'string' && /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/.test(path) &&
    path.split('/').every(p => p && p !== '.' && p !== '..' && !/[. ]$/.test(p) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))
}

export function validateFastflowlm(entry, { allowCandidates = false } = {}) {
  const fail = message => { throw new Error(`FastFlowLM: ${message}`) }
  const d = entry.definition
  if (entry.format !== 'fastflowlm' || !object(d)) fail('invalid format/definition')
  if (!id.test(d.model_id ?? '') || !id.test(d.variant_id ?? '') || !/^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/.test(d.checkpoint ?? '')) fail('invalid model/variant/checkpoint')
  if (Object.keys(entry.variants).length !== 1 || !object(entry.variants[d.variant_id])) fail('variant must match definition.variant_id')
  if (entry.omit_revisions !== undefined || entry.files !== undefined) fail('FLM sources/files belong to definition; revisions cannot be omitted')
  if (!/^flm-\d+\.\d+\.\d+-r[1-9]\d*$/.test(d.minimum_flm_version ?? '') || d.local_only_protocol !== 1 || d.npu_generation !== 'xdna2') fail('incompatible engine/protocol/NPU')
  if (!Number.isSafeInteger(d.context_length) || d.context_length < 1 || !d.license?.trim() || typeof d.gated !== 'boolean') fail('missing context/license/gated')
  if (!object(d.capabilities) || ['chat', 'tools', 'reasoning', 'structured_output'].some(k => typeof d.capabilities[k] !== 'boolean') || !d.capabilities.chat) fail('invalid chat capabilities')
  if (!object(d.qualification) || !['candidate', 'qualified'].includes(d.qualification.status) || !Array.isArray(d.qualification.evidence)) fail('missing qualification')
  if (d.qualification.status === 'candidate' && !allowCandidates) fail('unqualified candidate cannot enter production catalog')
  if (d.qualification.status === 'qualified' && (d.qualification.evidence.length === 0 || d.qualification.evidence.some(url => !/^https:\/\//.test(url)))) fail('qualified model requires live evidence')
  if (!Array.isArray(d.sources) || !d.sources.length || !Array.isArray(d.files) || !d.files.length) fail('missing immutable sources/full file plan')
  const sources = new Set(), used = new Set(), paths = new Map()
  for (const source of d.sources) {
    if (!object(source) || !id.test(source.id ?? '') || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.repo ?? '') || !/^[0-9a-f]{40}$/.test(source.revision ?? '')) fail('invalid immutable source')
    if (source.host !== undefined && !['huggingface', 'github'].includes(source.host)) fail('unknown source host')
    if (source.repo.split('/').some(segment => segment === '.' || segment === '..')) fail('unsafe source repo')
    if (sources.has(source.id)) fail('duplicate source id')
    sources.add(source.id)
  }
  for (const file of d.files) {
    if (!object(file) || !sources.has(file.source)) fail('unknown file source')
    if (!safeModelPath(file.path) || !safeModelPath(file.source_path)) fail('unsafe file path')
    if (!Number.isSafeInteger(file.size) || file.size < 1 || !hash.test(file.sha256 ?? '')) fail('every file needs size and SHA-256, including small files')
    const key = file.path.toLowerCase()
    if (paths.has(key)) fail('duplicate/case-colliding target path')
    paths.set(key, file.path); used.add(file.source)
  }
  for (const path of paths.keys()) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) if (paths.has(parts.slice(0, i).join('/'))) fail('file/directory target collision')
  }
  if (used.size !== sources.size) fail('unused source')
  if (!object(d.components)) fail('missing component inventory')
  const covered = new Set()
  for (const role of ['weights', 'tokenizer', 'config', 'chat_template', 'kernels', 'metadata']) {
    const list = d.components[role]
    if (!Array.isArray(list) || (!['kernels', 'metadata'].includes(role) && list.length === 0)) fail(`missing ${role} component`)
    if (new Set(list).size !== list.length) fail(`duplicate ${role} component`)
    for (const path of list) {
      if (typeof path !== 'string' || paths.get(path.toLowerCase()) !== path) fail(`incomplete file plan: ${role}/${path}`)
      covered.add(path)
    }
  }
  if (covered.size !== paths.size) fail('files outside component inventory')
  return entry
}

export function projectFastflowlm(catalog, options) {
  const collection = catalog.collections['fastflowlm-models']
  if (collection === undefined) return { schema_version: 1, models: [] }
  if (!object(collection.header) || collection.header.schema_version !== 1 || !Array.isArray(collection.entries)) throw new Error('Invalid FastFlowLM collection')
  const seen = new Set()
  return { ...collection.header, models: collection.entries.map(ref => {
    const entry = catalog.models[ref.model]
    if (!entry || entry.kind !== 'fastflowlm' || ref.variant !== entry.definition.variant_id) throw new Error('Invalid FastFlowLM collection reference')
    if (seen.has(ref.model)) throw new Error('Duplicate FastFlowLM collection reference')
    seen.add(ref.model)
    return structuredClone(validateFastflowlm(entry, options).definition)
  }) }
}
