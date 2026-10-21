import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { checkModels } from './litert-lm-models-check.mjs'

const list = JSON.parse(readFileSync(new URL('../../models/litert-lm-models.json', import.meta.url), 'utf8'))

// The published list may have no curated models, so the broken copies start
// from the real `huggingface` block plus one model in the shape a curated
// Gemma 4 entry has: cpu, gpu and an Intel NPU variant.
const file = (path) => ({ path, size: 1, sha256: 'a'.repeat(64) })
function sample() {
  const data = structuredClone(list)
  data.models = [
    {
      id: 'gemma-4-e2b',
      name: 'Gemma 4 E2B',
      description: 'Sample',
      task: 'chat',
      license: 'gemma',
      repo: 'litert-community/gemma-4-E2B-it-litert-lm',
      revision: '0'.repeat(40),
      gated: false,
      context_length: 32768,
      tools: true,
      reasoning: true,
      vision: true,
      variants: [
        { id: 'gemma-4-e2b-cpu', backend: 'cpu', platforms: ['macos-arm64', 'linux-x64', 'linux-arm64', 'win-x64'], file: file('gemma-4-E2B-it.litertlm') },
        { id: 'gemma-4-e2b-gpu', backend: 'gpu', platforms: ['macos-arm64', 'win-x64'], file: file('gemma-4-E2B-it-gpu.litertlm') },
        { id: 'gemma-4-e2b-npu-lnl', backend: 'npu', npu: 'intel-lnl', platforms: ['win-x64'], file: file('gemma-4-E2B-it_intel_LNL.litertlm') },
      ],
    },
  ]
  return data
}
const errorsOf = (data) => checkModels(data).join('\n')

test('the published list and the sample pass', () => {
  assert.deepEqual(checkModels(list), [])
  assert.deepEqual(checkModels(sample()), [])
})

test('duplicate model ids, variant ids across models and repos fail', () => {
  let data = sample()
  data.models.push({ ...structuredClone(data.models[0]), repo: 'litert-community/other', variants: [] })
  assert.match(errorsOf(data), /Duplicate model id: gemma-4-e2b/)

  data = sample()
  const other = structuredClone(data.models[0])
  other.id = 'gemma-4-e4b'
  other.repo = 'litert-community/gemma-4-E4B-it-litert-lm'
  other.variants = [other.variants[0]]
  data.models.push(other)
  assert.match(errorsOf(data), /Duplicate variant id: gemma-4-e2b-cpu/)

  data = sample()
  data.models.push({ ...structuredClone(data.models[0]), id: 'gemma-4-e2b-again', variants: [] })
  assert.match(errorsOf(data), /repo litert-community\/gemma-4-E2B-it-litert-lm is already listed/)
})

test('an NPU variant outside win-x64 fails', () => {
  const data = sample()
  data.models[0].variants[2].platforms.push('linux-x64')
  assert.match(errorsOf(data), /gemma-4-e2b-npu-lnl: npu does not run on linux-x64/)
})

test('an unsafe file path fails', () => {
  for (const path of ['../escape.litertlm', '/abs/model.litertlm', 'a/./b.litertlm', 'a//b.litertlm']) {
    const data = sample()
    data.models[0].variants[0].file.path = path
    assert.match(errorsOf(data), /unsafe file path/, path)
  }
})

test('huggingface.backends with an unknown platform or NPU off Windows fails', () => {
  let data = sample()
  data.huggingface.backends['win-arm64'] = ['cpu']
  assert.match(errorsOf(data), /unknown platform win-arm64/)

  data = sample()
  data.huggingface.backends['macos-arm64'] = ['cpu', 'npu']
  assert.match(errorsOf(data), /npu does not run on macos-arm64/)
})

test('closing GPU on a platform is a data change that still passes', () => {
  const data = sample()
  data.huggingface.backends['win-x64'] = ['cpu', 'npu']
  data.models[0].variants[1].platforms = ['macos-arm64']
  assert.deepEqual(checkModels(data), [])
})
