// Integrity checks for models/litert-lm-models.json that JSON Schema cannot
// express. The Atomic Chat app and `atc` read this list to offer and download
// LiteRT-LM models; `make validate` and CI both run this file. Pass other
// paths as arguments to check a local copy instead.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Where each backend can run at all: the library ships for four platforms,
// and the only NPU path is Intel through OpenVINO, on Windows. A variant or a
// Hugging Face backend offered outside these is one the host can never load.
const ALL = ['macos-arm64', 'linux-x64', 'linux-arm64', 'win-x64']
const BACKEND_PLATFORMS = { cpu: ALL, gpu: ALL, npu: ['win-x64'] }

const allowed = (backend, platform) => (BACKEND_PLATFORMS[backend] ?? []).includes(platform)

export function checkModels(data) {
  const errors = []

  for (const [platform, backends] of Object.entries(data.huggingface?.backends ?? {})) {
    if (!ALL.includes(platform)) {
      errors.push(`huggingface.backends: unknown platform ${platform}`)
      continue
    }
    for (const b of backends) {
      if (!allowed(b, platform)) errors.push(`huggingface.backends: ${b} does not run on ${platform}`)
    }
  }

  const modelIds = new Set()
  const variantIds = new Set()
  const repos = new Map()
  for (const m of data.models ?? []) {
    if (modelIds.has(m.id)) errors.push(`Duplicate model id: ${m.id}`)
    modelIds.add(m.id)
    // A Hugging Face model with the same repo is replaced by the curated
    // entry; two curated entries for one repo leave that ambiguous.
    if (repos.has(m.repo)) errors.push(`${m.id}: repo ${m.repo} is already listed as ${repos.get(m.repo)}`)
    repos.set(m.repo, m.id)
    if (!Array.isArray(m.variants) || m.variants.length === 0) {
      errors.push(`Model ${m.id} has no variants`)
      continue
    }

    for (const v of m.variants) {
      // Variant ids name the download task and the folder on disk, so they
      // are unique across the whole list, not only within a model.
      if (variantIds.has(v.id)) errors.push(`Duplicate variant id: ${v.id}`)
      variantIds.add(v.id)

      for (const p of v.platforms ?? []) {
        if (!allowed(v.backend, p)) errors.push(`${v.id}: ${v.backend} does not run on ${p}`)
      }

      const path = String(v.file?.path ?? '')
      if (path.startsWith('/') || path.split('/').some((s) => s === '' || s === '.' || s === '..')) {
        errors.push(`${v.id}: unsafe file path ${path}`)
      }
    }
  }
  return errors
}

function main(args) {
  const paths = args.length > 0 ? args : ['models/litert-lm-models.json']
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

    const variants = (data.models ?? []).reduce((n, m) => n + m.variants.length, 0)
    console.log(`${path} passed all integrity checks.`)
    console.log(`  models: ${data.models.length}, variants: ${variants}`)
    console.log(`  huggingface: ${data.huggingface.orgs.join(', ')}`)
  }
  if (failed) process.exit(1)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2))
}
