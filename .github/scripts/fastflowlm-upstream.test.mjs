import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateFastflowlm } from './fastflowlm-models.mjs'
const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url)))

test('upstream provenance is accepted without inventing hardware evidence', () => {
  const entry = read('../fixtures/fastflowlm/model-candidate.json')
  entry.definition.qualification = { status: 'upstream', evidence: ['https://github.com/ROCm/FastFlowLM/blob/pinned/src/model_list.json'] }
  assert.equal(validateFastflowlm(entry), entry)
  entry.definition.qualification.evidence = []
  assert.throws(() => validateFastflowlm(entry), /evidence/)
})

test('all upstream XDNA2 chat checkpoints are installable catalog entries with exactly ten editorial recommendations', () => {
  const upstream = read('../fixtures/fastflowlm/upstream-catalog.json')
  const catalog = read('../../models/catalog.json')
  const expected = Object.entries(upstream.models).flatMap(([family, variants]) =>
    Object.entries(variants).filter(([, m]) => m.supported_platforms.includes('aie2p') &&
      !m.label?.some(label => ['embeddings', 'decision', 'transcription', 'realtime-transcription'].includes(label)))
      .map(([tag]) => `${family}:${tag}`)).sort()
  const entries = catalog.collections['fastflowlm-models'].entries.map(ref => catalog.models[ref.model])
  assert.deepEqual(entries.map(e => e.definition.checkpoint).sort(), expected)
  for (const entry of entries) {
    validateFastflowlm(entry)
    assert.equal(entry.definition.name.includes('candidate'), false)
    assert.equal(typeof entry.definition.recommended, 'boolean')
    assert.equal(entry.definition.suggested, undefined)
    assert.equal(entry.definition.qualification.status, entry.definition.checkpoint === 'qwen3:0.6b' ? 'qualified' : 'upstream')
  }
  assert.equal(entries.filter(e => e.definition.recommended).length, 10)
  const flmIds = new Set(Object.keys(catalog.models).filter(k => catalog.models[k].kind === 'fastflowlm'))
  assert.ok(!JSON.stringify(catalog.collections.recommended).includes('fastflowlm:'))
  assert.equal(flmIds.size, expected.length)
})
