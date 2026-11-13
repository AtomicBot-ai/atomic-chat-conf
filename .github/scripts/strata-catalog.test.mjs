import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateStrataModel, projectStrata } from './strata-catalog.mjs'

const read = path => JSON.parse(readFileSync(path, 'utf8'))
const catalog = () => read('models/catalog.json')
const candidate = read('backends/strata-manifest.candidate.json')
const sample = family => Object.values(catalog().models).find(m => m.kind === 'strata' && m.definition.family === family)

test('strata-catalog: three complete recipes cover every candidate host variant', () => {
  const models = projectStrata(catalog(), candidate).models
  assert.deepEqual(new Set(models.map(d => d.family)), new Set(['qwen38', 'qwen36', 'deepseek41']))
  for (const v of candidate.variants) {
    for (const family of v.families) assert.ok(models.some(d => d.family === family && d.compatible_variants.includes(v.id)), `${v.id}/${family}`)
  }
  for (const d of models) {
    assert.equal(d.qualification.status, 'upstream-supported')
    assert.equal(d.requirements.requires_core_check, true)
    assert.deepEqual(d.requirements.disk_components, ['sources', 'derivatives', 'temporary', 'previous-installation'])
  }
})

test('strata-catalog: every file matches independently retained pinned source evidence', () => {
  const evidence = read('.github/fixtures/strata/model-source-evidence.json')
  for (const d of projectStrata(catalog()).models) for (const f of d.files) {
    const source = d.sources.find(s => s.id === f.source)
    const record = evidence.files.find(e => e.source.repo === source.repo && e.source.revision === source.revision && e.source_path === f.source_path)
    assert.ok(record, f.source_path)
    assert.equal(f.size, record.size)
    assert.equal(f.sha256, record.sha256)
    if (record.hub_lfs_sha256) assert.equal(f.sha256, record.hub_lfs_sha256)
  }
})

test('strata-catalog: missing weight shards and drafter inputs cannot become an install plan', () => {
  for (const family of ['qwen38', 'deepseek41']) {
    let model = sample(family), d = model.definition
    const missing = d.inputs.weights.pop()
    d.files = d.files.filter(f => f.path !== missing)
    d.requirements.download_bytes = d.files.reduce((n, f) => n + f.size, 0)
    assert.throws(() => validateStrataModel(model), /weight shard/)
    model = sample(family); d = model.definition
    d.files = d.files.filter(f => f.path !== d.inputs.drafter)
    d.requirements.download_bytes = d.files.reduce((n, f) => n + f.size, 0)
    assert.throws(() => validateStrataModel(model), /drafter input/)
  }
  const model = sample('qwen36'); delete model.definition.inputs.drafter_embedded_in
  assert.throws(() => validateStrataModel(model), /weights input/)
})

test('strata-catalog: paths, case collisions and mutable/incomplete sources are refused', () => {
  for (const path of ['../escape', '/absolute', 'C:/weights', 'a\\b', 'a//b', 'a/%2e%2e/b']) {
    const model = sample('qwen38'); model.definition.files[0].path = path
    assert.throws(() => validateStrataModel(model), /file plan/)
  }
  for (const mutate of [d => d.sources[0].revision = 'main', d => delete d.files[0].sha256, d => d.files[1].path = d.files[0].path.toUpperCase(), d => d.files[0].source = 'missing', d => d.files[0].size = -1]) {
    const model = sample('qwen38'); mutate(model.definition)
    assert.throws(() => validateStrataModel(model), /file plan|immutable/)
  }
})

test('strata-catalog: Qwen3.6/Metal and DeepSeek/SYCL are rejected before acquisition', () => {
  for (const [family, variant] of [['qwen36', 'macos-arm64-metal'], ['qwen36', 'linux-x64-sycl'], ['deepseek41', 'linux-x64-sycl'], ['deepseek41', 'linux-x64-cuda12']]) {
    const model = sample(family); model.definition.compatible_variants.push(variant)
    assert.throws(() => validateStrataModel(model, candidate), /does not support/)
  }
  const model = sample('deepseek41'); model.definition.inputs.experts_per_token = 5
  assert.throws(() => validateStrataModel(model), /six active experts/)
})

test('strata-catalog: wrong recipe/build, absent collection and invalid collection references', () => {
  const model = sample('qwen38'); model.definition.engine_release = 'strata-0.1.58-r1'
  assert.throws(() => validateStrataModel(model, candidate), /model\/build/)
  const old = catalog(); delete old.collections['strata-models']
  assert.deepEqual(projectStrata(old), { schema_version: 1, models: [] })
  const bad = catalog(); bad.collections['strata-models'].entries[0].variant = 'unknown'
  assert.throws(() => projectStrata(bad), /collection reference/)
})
