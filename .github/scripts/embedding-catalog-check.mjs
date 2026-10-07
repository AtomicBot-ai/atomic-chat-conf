// Integrity checks for models/embedding.json that JSON Schema cannot express.
// Mirrors the client's parser (web-app/src/services/embedding-catalog-registry.ts):
// a model that fails here is one the app would drop on load.
import { readFileSync } from 'node:fs'

const path = 'models/embedding.json'
const data = JSON.parse(readFileSync(path, 'utf8'))
const errors = []

if (data.schema_version !== 1) {
  errors.push('schema_version must be 1 (bump SUPPORTED_SCHEMA_VERSION in the client first)')
}

const ids = new Set()
let defaults = 0
for (const m of data.models ?? []) {
  if (ids.has(m.id)) errors.push(`Duplicate model id: ${m.id}`)
  ids.add(m.id)
  if (m.default === true) defaults++

  const files = m.files ?? []
  const paths = new Set()
  for (const f of files) {
    if (paths.has(f.path)) errors.push(`${m.id}: duplicate file ${f.path}`)
    paths.add(f.path)
    if (f.path.split('/').some((s) => s === '' || s === '.' || s === '..')) {
      errors.push(`${m.id}: unsafe file path ${f.path}`)
    }
  }
  const models = files.filter((f) => f.role === 'model')
  const projectors = files.filter((f) => f.role === 'mmproj')
  if (models.length !== 1) errors.push(`${m.id}: needs exactly one file with role "model" (found ${models.length})`)
  if (projectors.length > 1) errors.push(`${m.id}: at most one file with role "mmproj" (found ${projectors.length})`)

  const modalities = m.modalities ?? []
  const multimodal = modalities.some((x) => x !== 'text')
  if (multimodal && projectors.length === 0) {
    errors.push(`${m.id}: modalities ${modalities.join(', ')} need an "mmproj" file`)
  }
  if (!multimodal && projectors.length > 0) {
    errors.push(`${m.id}: an "mmproj" file needs a modality beyond text`)
  }
  if (m.image_max_tokens !== undefined && !modalities.includes('image')) {
    errors.push(`${m.id}: image_max_tokens is only for models that read images`)
  }
  if (m.image_max_tokens !== undefined && m.image_max_tokens * 2 > m.context) {
    // llama-server caps an image at half the batch; a larger budget is silently cut.
    errors.push(`${m.id}: image_max_tokens ${m.image_max_tokens} exceeds half of context ${m.context}`)
  }
  if (m.max_context < m.context) errors.push(`${m.id}: max_context ${m.max_context} is below context ${m.context}`)

  const dims = m.matryoshka_dims ?? []
  for (let i = 0; i < dims.length; i++) {
    if (dims[i] >= m.dims) errors.push(`${m.id}: matryoshka_dims ${dims[i]} is not below dims ${m.dims}`)
    if (i > 0 && dims[i] >= dims[i - 1]) errors.push(`${m.id}: matryoshka_dims must be strictly decreasing`)
  }
}

if (defaults !== 1) errors.push(`exactly one default model (found ${defaults})`)

if (errors.length > 0) {
  console.error('Embedding catalog validation failed:')
  for (const e of errors) console.error('  - ' + e)
  process.exit(1)
}

console.log('Embedding catalog passed all integrity checks.')
console.log(`  models: ${data.models.length}`)
console.log(`  updated_at: ${data.updated_at}`)
