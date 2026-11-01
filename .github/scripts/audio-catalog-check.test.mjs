import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { checkAudioCatalog } from './audio-catalog-check.mjs'

const live = () => JSON.parse(readFileSync('models/audio.json', 'utf8'))

test('the catalog passes', () => {
  assert.deepEqual(checkAudioCatalog(live()), [])
})

test('refuses a model that needs eSpeak-ng', () => {
  const catalog = live()
  catalog.models[0].family = 'kokoro_tts'
  assert.match(checkAudioCatalog(catalog).join('\n'), /needs eSpeak-ng/)
})

test('a generating model must name its length', () => {
  const catalog = live()
  const sfx = catalog.models.find((model) => model.mode === 'effects')
  delete sfx.defaults.durationSec
  sfx.controls = sfx.controls.filter((control) => control !== 'durationSec')
  const errors = checkAudioCatalog(catalog).join('\n')
  assert.match(errors, /needs the durationSec control/)
  assert.match(errors, /needs defaults\.durationSec/)
})

test('a default length stays in its range', () => {
  const catalog = live()
  catalog.models.find((model) => model.mode === 'music').defaults.durationSec = 600
  assert.match(checkAudioCatalog(catalog).join('\n'), /outside ranges/)
})

test('one recommended quant, no file twice, a path that ends in its filename', () => {
  const catalog = live()
  const [first, second] = catalog.models
  first.quants[0].recommended = false
  second.quants[0].filename = first.quants[0].filename
  const errors = checkAudioCatalog(catalog).join('\n')
  assert.match(errors, /exactly one recommended/)
  assert.match(errors, /another model's file/)
  assert.match(errors, /does not end in/)
})

test('every mode has a model, on its task', () => {
  const catalog = live()
  catalog.models = catalog.models.filter((model) => model.mode !== 'effects')
  catalog.models[0].task = 'gen'
  const errors = checkAudioCatalog(catalog).join('\n')
  assert.match(errors, /no effects model/)
  assert.match(errors, /speech is served by task tts/)
})

test('a default voice needs the voice control', () => {
  const catalog = live()
  catalog.models[0].controls = ['seed']
  assert.match(checkAudioCatalog(catalog).join('\n'), /default_voice without/)
})
