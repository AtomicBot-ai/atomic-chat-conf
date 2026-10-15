// Integrity checks for models/foundry-local-models.json that JSON Schema
// cannot express. The Atomic Chat app reads this list to offer and download
// Foundry Local models; `make validate` and CI both run this file. Pass other
// paths as arguments to check a local copy instead.
import { readFileSync } from 'node:fs'

// Where each execution provider can run at all. A variant offered outside
// these is one the host can never load.
const EP_PLATFORMS = {
  cpu: ['win-x64', 'win-arm64', 'macos-arm64', 'linux-x64', 'linux-arm64'],
  cuda: ['win-x64', 'linux-x64'],
  webgpu: ['win-x64', 'win-arm64', 'macos-arm64'],
  openvino: ['win-x64', 'win-arm64'],
  qnn: ['win-x64', 'win-arm64'],
  vitisai: ['win-x64', 'win-arm64'],
}

const paths = process.argv.slice(2)
if (paths.length === 0) paths.push('models/foundry-local-models.json')

let failed = false
for (const path of paths) {
  const data = JSON.parse(readFileSync(path, 'utf8'))
  const errors = []

  const template = data.resolver?.url_template ?? ''
  for (const slot of ['{region}', '{asset_id}']) {
    if (!template.includes(slot)) errors.push(`resolver.url_template must contain ${slot}`)
  }
  if (!/^https:\/\/\S+$/.test(data.catalog?.url ?? '')) errors.push('catalog.url must be an https URL')

  const modelIds = new Set()
  const variantIds = new Set()
  const sources = new Map()
  for (const m of data.models ?? []) {
    if (modelIds.has(m.id)) errors.push(`Duplicate model id: ${m.id}`)
    modelIds.add(m.id)
    if (!Array.isArray(m.variants) || m.variants.length === 0) {
      errors.push(`Model ${m.id} has no variants`)
      continue
    }

    for (const v of m.variants) {
      // Variant ids name the download task and the folder on disk, so they
      // are unique across the whole list, not only within a model.
      if (variantIds.has(v.id)) errors.push(`Duplicate variant id: ${v.id}`)
      variantIds.add(v.id)

      // The app prefers the curated entry for a catalog variant by asset id
      // and version; two curated entries for one asset leave that ambiguous.
      if (v.source?.kind === 'azureml') {
        const key = v.source.asset_id
        if (sources.has(key)) errors.push(`${v.id}: asset ${key} is already listed as ${sources.get(key)}`)
        sources.set(key, v.id)
        if (!String(v.source.asset_id).endsWith(`/versions/${v.source.version}`)) {
          errors.push(`${v.id}: asset_id does not end with /versions/${v.source.version}`)
        }
      }

      if ((v.device === 'cpu') !== (v.execution_provider === 'cpu')) {
        errors.push(`${v.id}: device ${v.device} does not match execution provider ${v.execution_provider}`)
      }
      for (const p of v.platforms ?? []) {
        if (!(EP_PLATFORMS[v.execution_provider] ?? []).includes(p)) {
          errors.push(`${v.id}: ${v.execution_provider} does not run on ${p}`)
        }
      }
      if (v.context_length !== undefined && v.context_length >= m.context_length) {
        errors.push(`${v.id}: context_length is only for a context smaller than the model's ${m.context_length}`)
      }

      const filePaths = new Set()
      for (const f of v.files ?? []) {
        if (filePaths.has(f.path)) errors.push(`${v.id}: duplicate file ${f.path}`)
        filePaths.add(f.path)
        if (String(f.path).split('/').some((s) => s === '.' || s === '..')) {
          errors.push(`${v.id}: unsafe file path ${f.path}`)
        }
      }
      if (String(v.source?.path_prefix ?? '').split('/').some((s) => s === '.' || s === '..')) {
        errors.push(`${v.id}: unsafe path_prefix ${v.source.path_prefix}`)
      }
    }
  }

  if (errors.length > 0) {
    console.error(`${path} validation failed:`)
    for (const e of errors) console.error('  - ' + e)
    failed = true
    continue
  }

  console.log(`${path} passed all integrity checks.`)
  console.log(`  models: ${modelIds.size}, variants: ${variantIds.size}`)
  console.log(`  regions: ${data.resolver.regions.join(', ')}`)
}
if (failed) process.exit(1)
