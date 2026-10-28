import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'
import { checkModels } from './geniex-models-check.mjs'

// Two halves, both run by `make validate` and CI:
// - the schema, run through ajv exactly as `make validate` runs it, against
//   the real list and against broken copies of a sample;
// - the integrity checks as pure functions.
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SCHEMA = 'models/schema.geniex-models.json'
const LIST = 'models/geniex-models.json'
const list = JSON.parse(readFileSync(join(REPO_ROOT, LIST), 'utf8'))

// The published list may have no curated models, so the copies start from
// the real `huggingface` block plus one model of each kind in the shape the
// first release has: a vision GGUF with mmproj on every device, and a bundle
// under both chips.
const file = (path) => ({ path, size: 1, sha256: 'a'.repeat(64) })
const bundle = (name) => ({
  url: `https://qaihub-public-assets.s3.us-west-2.amazonaws.com/qai-hub-models/models/qwen3_4b/v1/snapdragon-x-elite/${name}.zip`,
  size: 1,
  sha256: 'b'.repeat(64),
})
function sample() {
  const data = structuredClone(list)
  data.models = [
    {
      id: 'gemma-4-e2b',
      name: 'Gemma 4 E2B',
      description: 'Sample',
      task: 'chat',
      license: 'apache-2.0',
      context_length: 32768,
      tools: true,
      reasoning: true,
      vision: true,
      kind: 'gguf',
      repo: 'google/gemma-4-E2B-it-qat-q4_0-gguf',
      revision: '0'.repeat(40),
      gated: true,
      file: file('gemma-4-E2B-it-Q4_0.gguf'),
      mmproj: file('mmproj-gemma-4-E2B-it-F16.gguf'),
      devices: ['npu', 'gpu', 'cpu', 'hybrid'],
      platforms: ['win-arm64'],
    },
    {
      id: 'qwen3-4b-qairt',
      name: 'Qwen3 4B (AI Hub)',
      description: 'Sample',
      task: 'chat',
      license: 'apache-2.0',
      context_length: 4096,
      tools: true,
      reasoning: true,
      vision: false,
      kind: 'qairt',
      variants: [
        { id: 'qwen3-4b-x-elite', chip: 'x-elite', bundle: bundle('x-elite'), precision: 'w4a16', min_runtime_version: '0.9.3' },
        { id: 'qwen3-4b-x2-elite', chip: 'x2-elite', bundle: bundle('x2-elite'), precision: 'w4a16' },
      ],
    },
  ]
  return data
}
const errorsOf = (data) => checkModels(data).join('\n')

const scratch = mkdtempSync(join(tmpdir(), 'geniex-models-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

// The exact command `make validate` runs, pointed at a given data file.
const ajv = (dataPath) => {
  const result = spawnSync(
    'npx',
    ['--yes', 'ajv-cli@5', 'validate', '-s', SCHEMA, '-d', dataPath, '--strict=false'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
  if (result.error) throw new Error(`Could not launch "npx": ${result.error.message}`)
  return result
}

const ajvOnSample = (name, mutate) => {
  const data = sample()
  mutate(data)
  const path = join(scratch, `${name}.json`)
  writeFileSync(path, JSON.stringify(data))
  return ajv(path)
}

const SCHEMA_BROKEN = {
  'bundle-without-chip': (d) => { delete d.models[1].variants[0].chip },
  'gguf-without-devices': (d) => { delete d.models[0].devices },
  'gguf-with-empty-devices': (d) => { d.models[0].devices = [] },
  'vision-without-mmproj': (d) => { delete d.models[0].mmproj },
  'file-without-sha256': (d) => { delete d.models[0].file.sha256 },
  'bundle-without-sha256': (d) => { delete d.models[1].variants[0].bundle.sha256 },
  'bundle-on-other-host': (d) => { d.models[1].variants[0].bundle.url = 'https://example.com/qwen3.zip' },
  'unknown-kind': (d) => { d.models[0].kind = 'onnx' },
  'unknown-device': (d) => { d.models[0].devices.push('tpu') },
  'unknown-chip': (d) => { d.models[1].variants[0].chip = 'x3-elite' },
  'unknown-quantization': (d) => { d.huggingface.quantizations.push('IQ2_XS') },
  'extra-field': (d) => { d.models[0].backend = 'npu' },
  'gguf-with-variants': (d) => { d.models[0].variants = d.models[1].variants },
  'bundle-without-variants': (d) => { d.models[1].variants = [] },
}

test('the real list passes the schema', () => {
  const result = ajv(LIST)
  assert.equal(result.status, 0, result.stderr)
})

test('the sample passes the schema', () => {
  const result = ajvOnSample('sample', () => {})
  assert.equal(result.status, 0, result.stderr)
})

test('a text GGUF without mmproj passes the schema', () => {
  const result = ajvOnSample('text-gguf', (d) => {
    d.models[0].vision = false
    delete d.models[0].mmproj
  })
  assert.equal(result.status, 0, result.stderr)
})

for (const [name, mutate] of Object.entries(SCHEMA_BROKEN)) {
  test(`schema rejects a copy with ${name}`, () => {
    const result = ajvOnSample(name, mutate)
    assert.notEqual(result.status, 0, `ajv accepted the ${name} copy`)
  })
}

test('the published list and the sample pass the integrity checks', () => {
  assert.deepEqual(checkModels(list), [])
  assert.deepEqual(checkModels(sample()), [])
})

test('duplicate model ids, variant ids, ids across kinds and repos fail', () => {
  let data = sample()
  data.models.push({ ...structuredClone(data.models[0]), repo: 'google/other' })
  assert.match(errorsOf(data), /Duplicate model id: gemma-4-e2b/)

  data = sample()
  data.models[1].variants[1].id = data.models[1].variants[0].id
  assert.match(errorsOf(data), /Duplicate variant id: qwen3-4b-x-elite/)

  data = sample()
  data.models[1].variants[0].id = 'gemma-4-e2b'
  assert.match(errorsOf(data), /Duplicate variant id: gemma-4-e2b \(already a model id\)/)

  data = sample()
  data.models.push({ ...structuredClone(data.models[0]), id: 'gemma-4-e2b-again' })
  assert.match(errorsOf(data), /repo google\/gemma-4-E2B-it-qat-q4_0-gguf is already listed/)
})

test('a device on a platform where it does not run, or an unknown platform, fails', () => {
  let data = sample()
  data.models[0].platforms.push('win-x64')
  assert.match(errorsOf(data), /gemma-4-e2b: unknown platform win-x64/)

  data = sample()
  data.models[0].devices.push('tpu')
  assert.match(errorsOf(data), /gemma-4-e2b: tpu does not run on win-arm64/)
})

test('an unsafe file or mmproj path fails', () => {
  for (const path of ['../escape.gguf', '/abs/model.gguf', 'a/./b.gguf', 'a//b.gguf']) {
    let data = sample()
    data.models[0].file.path = path
    assert.match(errorsOf(data), /unsafe file path/, path)

    data = sample()
    data.models[0].mmproj.path = path
    assert.match(errorsOf(data), /unsafe mmproj path/, path)
  }

  const data = sample()
  data.models[0].mmproj.path = data.models[0].file.path
  assert.match(errorsOf(data), /mmproj has the same path as the model file/)
})

test('a vision GGUF without mmproj and a GGUF without devices fail', () => {
  let data = sample()
  delete data.models[0].mmproj
  assert.match(errorsOf(data), /gemma-4-e2b: vision is true but there is no mmproj/)

  data = sample()
  data.models[0].devices = []
  assert.match(errorsOf(data), /Model gemma-4-e2b has no devices/)
})

test('two bundle variants for one chip, no variants, or an unknown kind fail', () => {
  let data = sample()
  data.models[1].variants[1].chip = 'x-elite'
  assert.match(errorsOf(data), /qwen3-4b-qairt: two variants for chip x-elite/)

  data = sample()
  data.models[1].variants = []
  assert.match(errorsOf(data), /Model qwen3-4b-qairt has no variants/)

  data = sample()
  data.models[0].kind = 'onnx'
  assert.match(errorsOf(data), /unknown kind onnx/)
})

test('huggingface.backends with an unknown platform or device fails', () => {
  let data = sample()
  data.huggingface.backends['win-x64'] = ['cpu']
  assert.match(errorsOf(data), /unknown platform win-x64/)

  data = sample()
  data.huggingface.backends['win-arm64'] = ['cpu', 'tpu']
  assert.match(errorsOf(data), /tpu does not run on win-arm64/)
})

test('closing NPU with data still passes', () => {
  const data = sample()
  data.huggingface.backends['win-arm64'] = ['gpu', 'cpu']
  data.models[0].devices = ['gpu', 'cpu']
  assert.deepEqual(checkModels(data), [])
})
