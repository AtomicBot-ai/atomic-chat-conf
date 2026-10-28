// Integrity checks for models/geniex-models.json that JSON Schema cannot
// express. The Atomic Chat app and `atc` read this list to offer and download
// GenieX models; `make validate` and CI both run this file. Pass other paths
// as arguments to check a local copy instead.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Where each device can run at all. GenieX ships for Windows on Snapdragon X
// only, where the Hexagon NPU, the Adreno GPU, the CPU and the hybrid mode
// all exist. A device or a Hugging Face backend offered outside these is one
// the host can never load; a new platform goes here and into the schema's
// enum together.
const ALL = ['win-arm64']
export const DEVICE_PLATFORMS = { npu: ALL, gpu: ALL, cpu: ALL, hybrid: ALL }

const allowed = (device, platform) => (DEVICE_PLATFORMS[device] ?? []).includes(platform)

const unsafePath = (path) =>
  path.startsWith('/') || path.split('/').some((s) => s === '' || s === '.' || s === '..')

export function checkModels(data) {
  const errors = []

  for (const [platform, devices] of Object.entries(data.huggingface?.backends ?? {})) {
    if (!ALL.includes(platform)) {
      errors.push(`huggingface.backends: unknown platform ${platform}`)
      continue
    }
    for (const d of devices) {
      if (!allowed(d, platform)) errors.push(`huggingface.backends: ${d} does not run on ${platform}`)
    }
  }

  // Model ids (gguf folders) and variant ids (bundle folders) share one
  // namespace: both name a folder in <data>/geniex/models and a download
  // task, so they are unique across the whole list, not only within a kind.
  const ids = new Map()
  const claim = (id, what) => {
    if (ids.has(id)) errors.push(`Duplicate ${what} id: ${id} (already a ${ids.get(id)} id)`)
    else ids.set(id, what)
  }
  const repos = new Map()
  for (const m of data.models ?? []) {
    claim(m.id, 'model')

    if (m.kind === 'gguf') {
      // A Hugging Face model with the same repo is replaced by the curated
      // entry; two curated entries for one repo leave that ambiguous.
      if (repos.has(m.repo)) errors.push(`${m.id}: repo ${m.repo} is already listed as ${repos.get(m.repo)}`)
      repos.set(m.repo, m.id)

      if (!Array.isArray(m.devices) || m.devices.length === 0) errors.push(`Model ${m.id} has no devices`)
      for (const p of m.platforms ?? []) {
        if (!ALL.includes(p)) {
          errors.push(`${m.id}: unknown platform ${p}`)
          continue
        }
        for (const d of m.devices ?? []) {
          if (!allowed(d, p)) errors.push(`${m.id}: ${d} does not run on ${p}`)
        }
      }

      for (const [field, f] of [['file', m.file], ['mmproj', m.mmproj]]) {
        if (!f) continue
        const path = String(f.path ?? '')
        if (unsafePath(path)) errors.push(`${m.id}: unsafe ${field} path ${path}`)
      }
      if (m.file && m.mmproj && m.file.path === m.mmproj.path) {
        errors.push(`${m.id}: mmproj has the same path as the model file`)
      }
      // The llama_cpp plugin reads images through the projector; a vision
      // model without one would be offered with images and fail on load.
      if (m.vision === true && !m.mmproj) errors.push(`${m.id}: vision is true but there is no mmproj`)
    } else if (m.kind === 'qairt') {
      if (!Array.isArray(m.variants) || m.variants.length === 0) {
        errors.push(`Model ${m.id} has no variants`)
        continue
      }
      // The client shows the one variant for the machine's chip; two for the
      // same chip leave it nothing to choose by.
      const chips = new Set()
      for (const v of m.variants) {
        claim(v.id, 'variant')
        if (chips.has(v.chip)) errors.push(`${m.id}: two variants for chip ${v.chip}`)
        chips.add(v.chip)
      }
    } else {
      errors.push(`Model ${m.id}: unknown kind ${m.kind}`)
    }
  }
  return errors
}

function main(args) {
  const paths = args.length > 0 ? args : ['models/geniex-models.json']
  let failed = false
  for (const path of paths) {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    const errors = checkModels(data)

    if (errors.length > 0) {
      console.error(`${path} validation failed:`)
      for (const e of errors) console.error('  - ' + e)
      failed = true
      continue
    }

    const models = data.models ?? []
    const gguf = models.filter((m) => m.kind === 'gguf').length
    const bundles = models.filter((m) => m.kind === 'qairt').reduce((n, m) => n + m.variants.length, 0)
    console.log(`${path} passed all integrity checks.`)
    console.log(`  models: ${models.length} (gguf: ${gguf}, bundles: ${bundles})`)
    console.log(`  huggingface quantizations: ${data.huggingface.quantizations.join(', ')}`)
  }
  if (failed) process.exit(1)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2))
}
