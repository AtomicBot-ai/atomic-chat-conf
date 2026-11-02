import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { checkAudioCatalog, checkAudioEntries } from './audio-catalog-check.mjs'
import { projectCollection } from './model-catalog.mjs'

const catalog = () => JSON.parse(readFileSync('models/catalog.json', 'utf8'))
const live = () => projectCollection(catalog(), 'audio', true)

test('the catalog passes', () => {
  assert.deepEqual(checkAudioEntries(catalog()), [])
  assert.deepEqual(checkAudioCatalog(live()), [])
})

test('an audio entry is keyed by its id and listed in the audio collection', () => {
  const edited = catalog()
  edited.models['audio:speech'] = edited.models['audio:moss-tts-nano-100m']
  delete edited.models['audio:moss-tts-nano-100m']
  const errors = checkAudioEntries(edited).join('\n')
  assert.match(errors, /audio:speech: the key of model moss-tts-nano-100m is audio:moss-tts-nano-100m/)
  assert.match(errors, /audio:speech: not in the audio collection/)
})

test('an audio entry is a gguf for audio-cpp with one variant per quant', () => {
  const edited = catalog()
  const entry = edited.models['audio:ace-step-1.5-turbo']
  entry.format = 'diffusion'
  entry.definition.engines = []
  delete entry.variants.q8_0
  entry.variants.q4_k = { selection: 'q4_k' }
  const errors = checkAudioEntries(edited).join('\n')
  assert.match(errors, /format is gguf/)
  assert.match(errors, /engines must name audio-cpp/)
  assert.match(errors, /variant q8_0 selects q8_0/)
  assert.match(errors, /variant q4_k names no quant/)
})

test('refuses a model that needs eSpeak-ng', () => {
  const collection = live()
  collection.models[0].family = 'kokoro_tts'
  assert.match(checkAudioCatalog(collection).join('\n'), /needs eSpeak-ng/)
})

test('a generating model must name its length', () => {
  const collection = live()
  const sfx = collection.models.find((model) => model.mode === 'effects')
  delete sfx.defaults.durationSec
  sfx.controls = sfx.controls.filter((control) => control !== 'durationSec')
  const errors = checkAudioCatalog(collection).join('\n')
  assert.match(errors, /needs the durationSec control/)
  assert.match(errors, /needs defaults\.durationSec/)
})

test('a default length stays in its range', () => {
  const collection = live()
  collection.models.find((model) => model.mode === 'music').defaults.durationSec = 600
  assert.match(checkAudioCatalog(collection).join('\n'), /outside ranges/)
})

test('one recommended quant, no file twice, a path that ends in its filename', () => {
  const collection = live()
  const [first, second] = collection.models
  first.quants[0].recommended = false
  second.quants[0].filename = first.quants[0].filename
  const errors = checkAudioCatalog(collection).join('\n')
  assert.match(errors, /exactly one recommended/)
  assert.match(errors, /another model's file/)
  assert.match(errors, /does not end in/)
})

test('every mode has a model, on its task', () => {
  const collection = live()
  collection.models = collection.models.filter((model) => model.mode !== 'effects')
  collection.models[0].task = 'gen'
  const errors = checkAudioCatalog(collection).join('\n')
  assert.match(errors, /no effects model/)
  assert.match(errors, /speech is served by task tts/)
})

test('a default voice needs the voice control', () => {
  const collection = live()
  collection.models[0].controls = ['seed']
  assert.match(checkAudioCatalog(collection).join('\n'), /default_voice without/)
})
