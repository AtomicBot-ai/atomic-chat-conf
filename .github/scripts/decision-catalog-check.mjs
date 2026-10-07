// Integrity checks for models/decision.json that JSON Schema cannot express.
// Mirrors the client's parser (web-app/src/services/decision-catalog-registry.ts):
// a model that fails here is one the app would drop on load.
import { readFileSync } from 'node:fs'

const path = 'models/decision.json'
const data = JSON.parse(readFileSync(path, 'utf8'))
const errors = []

// The TurboQuant engine refuses a checkpoint folder without these (DECISION.md, checkpoint directory).
const REQUIRED_CHECKPOINT_FILES = [
  'model.safetensors',
  'rl_agent_config.json',
  'encoder/config.json',
  'tokenizer/tokenizer.json',
]

// Clients that predate the engine field keep only checkpoint models, so the catalog
// must always carry at least one for them.
const isCheckpoint = (m) => (m.format ?? 'checkpoint') === 'checkpoint'

if (data.schema_version !== 1) {
  errors.push('schema_version must be 1 (bump SUPPORTED_SCHEMA_VERSION in the client first)')
}

const ids = new Set()
const defaults = new Map()
for (const m of data.models ?? []) {
  if (ids.has(m.id)) errors.push(`Duplicate model id: ${m.id}`)
  ids.add(m.id)
  const engine = m.engine ?? 'llamacpp'
  if (m.default === true) defaults.set(engine, (defaults.get(engine) ?? 0) + 1)

  const paths = new Set()
  for (const f of m.files ?? []) {
    if (paths.has(f.path)) errors.push(`${m.id}: duplicate file ${f.path}`)
    paths.add(f.path)
    if (f.path.split('/').some((s) => s === '' || s === '.' || s === '..')) {
      errors.push(`${m.id}: unsafe file path ${f.path}`)
    }
  }

  if (isCheckpoint(m)) {
    for (const required of REQUIRED_CHECKPOINT_FILES) {
      if (!paths.has(required)) errors.push(`${m.id}: missing required file ${required}`)
    }
    continue
  }

  const files = m.files ?? []
  const models = files.filter((f) => f.role === 'model')
  const projectors = files.filter((f) => f.role === 'mmproj')
  if (models.length !== 1) errors.push(`${m.id}: a GGUF model needs exactly one file with role "model" (found ${models.length})`)
  if (projectors.length > 1) errors.push(`${m.id}: at most one file with role "mmproj" (found ${projectors.length})`)
  if (files.length !== models.length + projectors.length) errors.push(`${m.id}: every file of a GGUF model needs a role`)
  for (const f of files) {
    if (!f.path.endsWith('.gguf')) errors.push(`${m.id}: ${f.path} is not a .gguf file`)
  }
  if (m.vision === true && projectors.length === 0) errors.push(`${m.id}: a vision model needs an "mmproj" file`)
  if (m.vision !== true && projectors.length > 0) errors.push(`${m.id}: an "mmproj" file needs "vision": true`)
}

for (const [engine, count] of defaults) {
  if (count > 1) errors.push(`at most one default model per engine (${engine}: ${count})`)
}
if (!(data.models ?? []).some((m) => isCheckpoint(m) && m.default === true)) {
  errors.push('one checkpoint model must be default: clients that predate the engine field read only those')
}

if (errors.length > 0) {
  console.error('Decision catalog validation failed:')
  for (const e of errors) console.error('  - ' + e)
  process.exit(1)
}

console.log('Decision catalog passed all integrity checks.')
console.log(`  models: ${data.models.length}`)
console.log(`  updated_at: ${data.updated_at}`)
