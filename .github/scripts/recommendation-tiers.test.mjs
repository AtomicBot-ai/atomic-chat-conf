import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const manifest = read('../../models/recommended.json')
const schema = read('../../models/schema.json')
const evidence = read('../fixtures/high-tier-files.json')
const staffPicks = read('../../models/staff-picks.json')
const GiB = 1024 ** 3
// Same nominal-128 tolerance and memory-pool limits as the client.
const cases = [
  ['64', 48.5, 49, 'AtomicChat/Qwen3.6-35B-A3B-GGUF', 'Q6_K', 'Q4_K_M'],
  ['64_plus', 64.5, 65, 'Qwen/Qwen3-Coder-Next-GGUF', 'Q4_K_M', 'Q6_K'],
  ['128', 127.5, 127, 'unsloth/gpt-oss-120b-GGUF', 'Q8_0', 'Q8_0'],
  ['128_plus', 128.5, 129, 'unsloth/NVIDIA-Nemotron-3-Super-120B-A12B-GGUF', 'Q4_K_M', 'Q8_0'],
]

for (const [suffix, unifiedMin, vramMin, repo, pin, visionPin] of cases) {
  for (const pool of ['unified', 'vram']) {
    const tier = `${pool}_${suffix}`
    test(`${tier}: ordered lead, alternatives, vision, and worst-edge fit`, () => {
      assert.ok(schema.properties.tiers.properties[tier])
      const list = manifest.tiers[tier]
      assert.equal(list[0].model_name, repo)
      assert.equal(list[0].quant, pin)
      assert.ok(list.length >= 3)
      assert.equal(new Set(list.map((r) => r.model_name)).size, list.length)
      assert.ok(list.some((r) => r.model_name === 'AtomicChat/gemma-4-31B-it-GGUF' && r.quant === visionPin && r.mmproj_quant === 'F16'))
      for (const rec of list) {
        assert.ok(staffPicks.picks.some((m) => m.model_name === rec.model_name), 'candidate must come from local catalog')
        const proof = evidence.models.find((m) => m.repo === rec.model_name)
        assert.ok(proof, rec.model_name)
        const weights = proof.quants.find((q) => q.pin === rec.quant)
        assert.ok(weights, rec.quant)
        const projector = rec.mmproj_quant ? proof.projectors.find((p) => p.pin === rec.mmproj_quant) : null
        if (rec.mmproj_quant) assert.ok(projector, rec.mmproj_quant)
        const bytes = weights.files.reduce((sum, f) => sum + f.size, 0) + (projector?.size ?? 0)
        const budget = (pool === 'unified' ? unifiedMin * 0.85 : vramMin) * GiB
        assert.ok(bytes <= budget, `${tier}/${rec.model_name}: ${bytes} > ${budget}`)
      }
    })
  }
}

for (const model of evidence.models) {
  test(`${model.repo}: immutable metadata, exact quant tokens, complete shard sets`, () => {
    assert.match(model.revision, /^[a-f0-9]{40}$/)
    for (const quant of model.quants) {
      assert.ok(quant.files.length > 0)
      const seen = new Set()
      for (const file of quant.files) {
        assert.ok(Number.isSafeInteger(file.size) && file.size > 0)
        assert.match(file.sha256, /^[a-f0-9]{64}$/)
        assert.ok(!seen.has(file.path))
        seen.add(file.path)
        const match = file.path.match(/-((?:[IT]?Q\d[0-9A-Za-z_]*)|BF16|F16|F32)(?:-(\d{5})-of-(\d{5}))?\.gguf$/i)
        assert.equal(match?.[1].toUpperCase(), quant.pin)
        if (match[2]) {
          assert.equal(Number(match[3]), quant.files.length)
          assert.equal(Number(match[2]), seen.size)
        }
      }
    }
    for (const projector of model.projectors) {
      assert.match(projector.path, /^mmproj.*-f16\.gguf$/)
      assert.equal(projector.pin, 'F16')
      assert.ok(projector.size > 0)
      assert.match(projector.sha256, /^[a-f0-9]{64}$/)
    }
  })
}

test('additive vocabulary keeps schema v1 and all existing ids', () => {
  assert.equal(manifest.schema_version, 1)
  for (const pool of ['unified', 'vram']) {
    assert.ok(manifest.tiers[`${pool}_64_plus`])
  }
  assert.equal(Object.keys(manifest.tiers).length, 22)
  assert.deepEqual(Object.keys(manifest.tiers).sort(), Object.keys(schema.properties.tiers.properties).sort())
})
