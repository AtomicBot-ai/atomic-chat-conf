#!/usr/bin/env node
/**
 * What the schemas cannot say about the audio models of models/catalog.json, the only file they are
 * edited in (models/audio.json is its generated export). Run by `make validate` and validate.yml.
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { projectCollection } from './model-catalog.mjs'

/** eSpeak-ng is GPL and our builds leave it out: these families answer `Could not load eSpeak-ng`. */
const NEEDS_ESPEAK = new Set(['kokoro_tts', 'piper_tts', 'sanotts', 'inflect_v2', 'kitten_tts', 'kitten_tts2'])
const TASK_OF_MODE = { speech: 'tts', music: 'gen', effects: 'gen' }
const SHA256 = /^[0-9a-f]{64}$/
const ICON = /^[a-z0-9][a-z0-9-]*$/

/** The catalog's own rules for an audio entry: its key, its collection, and one variant per quant. */
export function checkAudioEntries(catalog) {
  const errors = []
  const listed = new Set((catalog.collections.audio?.entries ?? []).map((ref) => ref.model))
  for (const [key, entry] of Object.entries(catalog.models)) {
    if (entry.kind !== 'audio') continue
    const { id, quants = [], engines = [] } = entry.definition
    if (key !== `audio:${id}`) errors.push(`${key}: the key of model ${id} is audio:${id}`)
    if (!listed.has(key)) errors.push(`${key}: not in the audio collection, so no client offers it`)
    if (entry.format !== 'gguf') errors.push(`${key}: format is gguf`)
    if (!engines.includes('audio-cpp')) errors.push(`${key}: engines must name audio-cpp`)
    const expected = { default: 'all-required-files', ...Object.fromEntries(quants.map((quant) => [quant.id, quant.id])) }
    for (const [variant, selection] of Object.entries(expected))
      if (entry.variants[variant]?.selection !== selection) errors.push(`${key}: variant ${variant} selects ${selection}`)
    for (const variant of Object.keys(entry.variants))
      if (!(variant in expected)) errors.push(`${key}: variant ${variant} names no quant`)
    // The same file pin as a diffusion quant: what refresh-model-catalog.mjs reads from the HF commit.
    for (const quant of quants) {
      if (!Number.isSafeInteger(quant.bytes) || quant.bytes <= 0) errors.push(`${key}: quant ${quant.id} needs its bytes`)
      if (!SHA256.test(quant.sha256 ?? '')) errors.push(`${key}: quant ${quant.id} needs its LFS sha256, 64 lowercase hex`)
    }
  }
  return errors
}

/** The models as clients receive them: the `audio` collection projected with its pins. */
export function checkAudioCatalog(collection) {
  const errors = []
  const ids = new Set()
  const filenames = new Set()
  for (const model of collection.models) {
    const at = `audio:${model.id}`
    if (ids.has(at)) errors.push(`${at}: listed twice`)
    ids.add(at)
    if (NEEDS_ESPEAK.has(model.family)) errors.push(`${at}: ${model.family} needs eSpeak-ng, which no build carries`)
    if (model.task !== TASK_OF_MODE[model.mode]) errors.push(`${at}: ${model.mode} is served by task ${TASK_OF_MODE[model.mode]}`)
    if (model.quants.filter((quant) => quant.recommended).length !== 1) errors.push(`${at}: exactly one recommended quant`)
    const quantIds = new Set()
    for (const quant of model.quants) {
      if (quantIds.has(quant.id)) errors.push(`${at}: duplicate quant ${quant.id}`)
      quantIds.add(quant.id)
      if (filenames.has(quant.filename)) errors.push(`${at}: ${quant.filename} is another model's file`)
      filenames.add(quant.filename)
      if (quant.path.split('/').at(-1) !== quant.filename) errors.push(`${at}: ${quant.path} does not end in ${quant.filename}`)
    }
    // Stable Audio makes 120 s when a request names no length.
    if (model.task === 'gen') {
      if (!model.controls.includes('durationSec')) errors.push(`${at}: a generating model needs the durationSec control`)
      if (model.defaults.durationSec === undefined) errors.push(`${at}: a generating model needs defaults.durationSec`)
      const [min, max] = model.ranges?.durationSec ?? []
      if (min === undefined) errors.push(`${at}: a generating model needs ranges.durationSec`)
      else if (min >= max || model.defaults.durationSec < min || model.defaults.durationSec > max)
        errors.push(`${at}: defaults.durationSec is outside ranges.durationSec`)
    }
    if (model.default_voice && !model.controls.includes('voice')) errors.push(`${at}: default_voice without the voice control`)
    // What a model picker shows on one row: the developer's mark and one line of text.
    if (!ICON.test(model.icon ?? '')) errors.push(`${at}: icon names the developer's logo key`)
    if (model.description.length > 80) errors.push(`${at}: description is one line, at most 80 characters`)
  }
  for (const mode of Object.keys(TASK_OF_MODE))
    if (!collection.models.some((model) => model.mode === mode)) errors.push(`no ${mode} model`)
  return errors
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const catalog = JSON.parse(readFileSync('models/catalog.json', 'utf8'))
  const errors = [...checkAudioEntries(catalog), ...checkAudioCatalog(projectCollection(catalog, 'audio', true))]
  for (const error of errors) console.error(`models/catalog.json: ${error}`)
  if (errors.length > 0) process.exit(1)
  console.log('models/catalog.json: audio models ok')
}
