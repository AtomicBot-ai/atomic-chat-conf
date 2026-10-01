// Integrity checks for models/decision.json that JSON Schema cannot express.
// Mirrors the client's parser (web-app/src/services/decision-catalog-registry.ts):
// a model that fails here is one the app would drop on load.
import { readFileSync } from 'node:fs'

const path = 'models/decision.json'
const data = JSON.parse(readFileSync(path, 'utf8'))
const errors = []

// The engine refuses a checkpoint folder without these (DECISION.md, checkpoint directory).
const REQUIRED_FILES = [
  'model.safetensors',
  'rl_agent_config.json',
  'encoder/config.json',
  'tokenizer/tokenizer.json',
]

if (data.schema_version !== 1) {
  errors.push('schema_version must be 1 (bump SUPPORTED_SCHEMA_VERSION in the client first)')
}

const ids = new Set()
let defaults = 0
for (const m of data.models ?? []) {
  if (ids.has(m.id)) errors.push(`Duplicate model id: ${m.id}`)
  ids.add(m.id)
  if (m.default === true) defaults += 1

  const paths = new Set()
  for (const f of m.files ?? []) {
    if (paths.has(f.path)) errors.push(`${m.id}: duplicate file ${f.path}`)
    paths.add(f.path)
    if (f.path.split('/').some((s) => s === '' || s === '.' || s === '..')) {
      errors.push(`${m.id}: unsafe file path ${f.path}`)
    }
  }
  for (const required of REQUIRED_FILES) {
    if (!paths.has(required)) errors.push(`${m.id}: missing required file ${required}`)
  }
}
if (defaults !== 1) errors.push(`exactly one model must be default (found ${defaults})`)

if (errors.length > 0) {
  console.error('Decision catalog validation failed:')
  for (const e of errors) console.error('  - ' + e)
  process.exit(1)
}

console.log('Decision catalog passed all integrity checks.')
console.log(`  models: ${data.models.length}`)
console.log(`  updated_at: ${data.updated_at}`)
