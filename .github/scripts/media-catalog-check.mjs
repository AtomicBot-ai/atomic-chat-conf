// Integrity checks for providers/media.json that JSON Schema cannot express.
// Mirrors the core's parser (atomic-chat-core src/media/catalog.ts): an entry
// that fails here is one the core would drop on load.
import { readFileSync } from 'node:fs'

const path = 'providers/media.json'
const data = JSON.parse(readFileSync(path, 'utf8'))
const registry = JSON.parse(readFileSync('providers/registry.json', 'utf8'))
const errors = []

// Self-hosted providers the app ships itself rather than through the registry.
const APP_PROVIDERS = new Set(['automatic1111', 'sdcpp-server'])

const DIALECT_KIND = {
  'openai-images': 'image',
  'xai-images': 'image',
  'openrouter-images': 'image',
  'gemini-image': 'image',
  'minimax-image': 'image',
  'dashscope-image': 'image',
  'hf-images': 'image',
  'nvidia-genai': 'image',
  'mistral-agent-image': 'image',
  a1111: 'image',
  'openai-videos': 'video',
  'openrouter-videos': 'video',
  'xai-videos': 'video',
  'gemini-veo': 'video',
  'minimax-video': 'video',
  'minimax-video-v2': 'video',
  'dashscope-video': 'video',
  'aimlapi-videos': 'video',
  'hf-videos': 'video',
}
const WORKFLOWS = {
  image: new Set(['create', 'transform', 'inpaint', 'reference', 'edit']),
  video: new Set(['create', 'image-to-video']),
}
const HF_PROVIDERS = new Set(['fal-ai', 'hf-inference'])
const NVIDIA_SCHEMAS = new Set(['flux-schnell', 'flux-dev', 'flux2-klein', 'sd3'])

if (data.schema_version !== 1) {
  errors.push('schema_version must be 1 (bump the core parser first)')
}

function checkChoice(where, c) {
  if (c === undefined) return
  if (c.default !== undefined && !c.values.includes(c.default)) {
    errors.push(`${where}: default ${c.default} is not one of its values`)
  }
}

function checkRange(where, r) {
  if (r === undefined) return
  if (r.min > r.max) errors.push(`${where}: min ${r.min} is above max ${r.max}`)
  if (r.default !== undefined && (r.default < r.min || r.default > r.max)) {
    errors.push(`${where}: default ${r.default} is outside ${r.min}..${r.max}`)
  }
}

function checkImageParams(where, p) {
  const size = p.size
  if (size?.kind === 'enum') checkChoice(`${where}.size`, size)
  if (size?.kind === 'range') {
    checkRange(`${where}.size`, size)
    for (const dim of ['default_width', 'default_height']) {
      const v = size[dim]
      if (v === undefined) continue
      if (v < size.min || v > size.max) errors.push(`${where}.size: ${dim} ${v} is outside ${size.min}..${size.max}`)
      if (v % size.multiple !== 0) errors.push(`${where}.size: ${dim} ${v} is not a multiple of ${size.multiple}`)
    }
  }
  for (const key of ['aspect_ratios', 'resolutions', 'quality', 'background', 'output_format']) {
    checkChoice(`${where}.${key}`, p[key])
  }
  for (const key of ['steps', 'cfg', 'guidance', 'strength']) checkRange(`${where}.${key}`, p[key])
  if (p.aspect_ratios === undefined && p.resolutions !== undefined && p.size === undefined) {
    // A resolution tier alone is fine (DashScope wan2.7); nothing to check.
  }
}

function checkVideoParams(where, p) {
  const d = p.durations
  if (d !== undefined) {
    const listed = Array.isArray(d.values)
    const ranged = d.min !== undefined || d.max !== undefined
    if (listed === ranged) errors.push(`${where}.durations: give either values or min and max`)
    if (ranged) {
      if (d.min === undefined || d.max === undefined) errors.push(`${where}.durations: a range needs min and max`)
      else checkRange(`${where}.durations`, d)
    }
    if (listed && d.default !== undefined && !d.values.includes(d.default)) {
      errors.push(`${where}.durations: default ${d.default} is not one of its values`)
    }
  }
  for (const key of ['resolutions', 'aspect_ratios', 'sizes']) checkChoice(`${where}.${key}`, p[key])
}

function checkModel(where, kind, api, m) {
  for (const w of m.workflows) {
    if (!WORKFLOWS[kind].has(w)) errors.push(`${where}: workflow ${w} is not a ${kind} workflow`)
  }
  if (kind === 'image') checkImageParams(where, m.params)
  else checkVideoParams(where, m.params)
  const options = m.options ?? {}
  if (api === 'hf-images' || api === 'hf-videos') {
    if (!HF_PROVIDERS.has(options.hf_provider)) {
      errors.push(`${where}: options.hf_provider must be one of ${[...HF_PROVIDERS].join(', ')}`)
    }
    if (options.hf_provider === 'fal-ai' && typeof options.provider_model !== 'string') {
      errors.push(`${where}: a fal-ai model needs options.provider_model`)
    }
  }
  if (api === 'nvidia-genai' && !NVIDIA_SCHEMAS.has(options.schema)) {
    errors.push(`${where}: options.schema must be one of ${[...NVIDIA_SCHEMAS].join(', ')}`)
  }
}

for (const [dialect, kind] of Object.entries(DIALECT_KIND)) {
  const defaults = data.dialects?.[dialect]
  if (defaults === undefined) {
    errors.push(`dialects.${dialect}: missing defaults`)
    continue
  }
  if (defaults.kind !== kind) errors.push(`dialects.${dialect}: kind must be ${kind}`)
  for (const w of defaults.workflows) {
    if (!WORKFLOWS[kind].has(w)) errors.push(`dialects.${dialect}: workflow ${w} is not a ${kind} workflow`)
  }
  if (kind === 'image') checkImageParams(`dialects.${dialect}.params`, defaults.params)
  else checkVideoParams(`dialects.${dialect}.params`, defaults.params)
}
for (const dialect of Object.keys(data.dialects ?? {})) {
  if (!(dialect in DIALECT_KIND)) errors.push(`dialects.${dialect}: unknown dialect`)
}

const known = new Set(registry.providers.map((p) => p.provider))
let models = 0
for (const [provider, sections] of Object.entries(data.providers ?? {})) {
  if (!known.has(provider) && !APP_PROVIDERS.has(provider)) {
    errors.push(`${provider}: not a provider of providers/registry.json or one the app ships`)
  }
  for (const kind of ['image', 'video']) {
    const section = sections[kind]
    if (section === undefined) continue
    const where = `${provider}.${kind}`
    if (DIALECT_KIND[section.api] !== kind) errors.push(`${where}: api ${section.api} is not a ${kind} dialect`)
    const ids = new Set()
    let defaults = 0
    for (const m of section.models) {
      models++
      const at = `${where}.${m.id}`
      if (ids.has(m.id)) errors.push(`${where}: duplicate model id ${m.id}`)
      ids.add(m.id)
      if (m.default === true) defaults++
      const api = m.api ?? section.api
      if (DIALECT_KIND[api] !== kind) errors.push(`${at}: api ${api} is not a ${kind} dialect`)
      checkModel(at, kind, api, m)
    }
    if (defaults > 1) errors.push(`${where}: at most one default model (found ${defaults})`)
  }
}

if (errors.length > 0) {
  console.error('Media catalog validation failed:')
  for (const e of errors) console.error('  - ' + e)
  process.exit(1)
}

console.log('Media catalog passed all integrity checks.')
console.log(`  providers: ${Object.keys(data.providers).length}, models: ${models}`)
console.log(`  catalog_version: ${data.catalog_version}, updated_at: ${data.updated_at}`)
