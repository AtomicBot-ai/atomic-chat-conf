// Integrity rules beyond models/schema.mobile.json. Both catalogs are independent:
// an id can occur once in each, with different dev metadata or execution flags.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

export function checkMobileCatalog(data) {
  const errors = []
  const timestamp = data.updated_at
  const milliseconds = Date.parse(timestamp)
  const normalized = typeof timestamp === 'string'
    ? timestamp.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction = '') => `.${fraction.padEnd(3, '0')}Z`)
    : ''

  // ajv-cli without ajv-formats ignores date-time, including impossible dates.
  if (!DATE_TIME_RE.test(timestamp) || !Number.isFinite(milliseconds) ||
      new Date(milliseconds).toISOString() !== normalized) {
    errors.push('updated_at must be a valid UTC date-time')
  }

  const ids = new Set()
  for (const model of data.models ?? []) {
    if (ids.has(model.id)) errors.push(`Duplicate model id: ${model.id}`)
    ids.add(model.id)

    if (model.id === 'apple/intelligence') {
      errors.push('apple/intelligence is injected locally, never published')
    }

    for (const id of [model.id, model.mmprojRemoteId].filter((id) => typeof id === 'string')) {
      if (id.split('/').some((segment) => segment === '.' || segment === '..')) {
        errors.push(`${model.id}: unsafe remote id ${id}`)
      }
    }

    if (model.engine === 'llama' &&
        (model.id.split('/').length < 3 || !/\.gguf$/i.test(model.id))) {
      errors.push(`${model.id}: llama needs an exact GGUF file id`)
    }

    if (model.engine === 'coreml-diffusion' &&
        model.id.split('/').length > 2 && !/\.zip$/i.test(model.id)) {
      errors.push(`${model.id}: CoreML needs its own repository or ZIP artifact`)
    }

    if (model.mmprojRemoteId !== null && model.mmprojRemoteId !== undefined) {
      if (model.mmprojRemoteId.split('/').length < 3 || !/\.gguf$/i.test(model.mmprojRemoteId)) {
        errors.push(`${model.id}: mmprojRemoteId needs an exact GGUF file id`)
      }
      if (model.mmprojRemoteId === model.id) {
        errors.push(`${model.id}: model and projector must be different artifacts`)
      }
    }

    if (model.iconUrl?.startsWith('https://')) {
      try {
        const url = new URL(model.iconUrl)
        if (!url.hostname || url.username || url.password) throw new Error('invalid image URL')
      } catch {
        errors.push(`${model.id}: iconUrl must be a valid HTTPS image URL without credentials`)
      }
    }
  }

  return errors
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let failed = false
  for (const path of ['models/mobile.json', 'models/mobile-dev.json']) {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    const errors = checkMobileCatalog(data)
    if (errors.length > 0) {
      console.error(`${path} validation failed:`)
      for (const error of errors) console.error('  - ' + error)
      failed = true
    } else {
      console.log(`${path} passed all integrity checks (${data.models.length} models).`)
    }
  }
  if (failed) process.exit(1)
}
