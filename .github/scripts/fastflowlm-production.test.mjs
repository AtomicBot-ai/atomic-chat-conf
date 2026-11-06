import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = path => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url)))

test('production qualifies only the tested Qwen3 plan against immutable r2 builds', () => {
  const catalog = read('models/catalog.json')
  const candidate = read('.github/fixtures/fastflowlm/model-candidate.json')
  const selected = Object.entries(catalog.models).filter(([, model]) => model.kind === 'fastflowlm')
  assert.equal(selected.length, 1, 'one hardware-qualified chat model is required')
  const [key, entry] = selected[0]
  const definition = entry.definition
  const release = 'https://github.com/AtomicBot-ai/atomic-chat-core/releases/download/flm-1.0.11-r2/'
  assert.deepEqual(entry, {
    ...candidate,
    definition: {
      ...candidate.definition,
      minimum_flm_version: 'flm-1.0.11-r2',
      context_length: 2048,
      qualification: { status: 'qualified', evidence: [release + 'flm-1.0.11-r2-acceptance.json'] },
    },
  })
  assert.deepEqual(catalog.collections['fastflowlm-models'].entries, [{ model: key, variant: definition.variant_id }])
  const manifest = read('backends/fastflowlm-manifest.json')
  assert.equal(manifest.releases.length, 1)
  const build = manifest.releases[0]
  assert.equal(build.version, definition.minimum_flm_version)
  assert.equal(build.min_core_version, '0.22.0')
  assert.equal(build.local_only_protocol, 1)
  assert.equal(build.upstream_commit, definition.sources.find(source => source.host === 'github').revision)
  assert.deepEqual(build.assets.map(asset => asset.platform).sort(), ['linux-x64-npu', 'win-x64-npu'])
  for (const asset of build.assets) assert.ok(asset.url.startsWith(release))
  assert.equal(build.provenance.document.url, release + 'flm-1.0.11-r2-provenance.json')
})

test('excluded clean driver installation paths publish no qualified recipes', () => {
  for (const platform of ['windows', 'linux']) {
    assert.deepEqual(read(`runtimes/environments/fastflowlm-${platform}.json`).recipes, [])
  }
})
