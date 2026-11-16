import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { parseAtomicModelCatalog, projectAtomicModelCollection } from '../fixtures/fastflowlm/legacy-model-catalog.ts'
import { validateCatalog, projectCollection } from './model-catalog.mjs'
import { projectStrata } from './strata-catalog.mjs'
import { canonicalJSON } from './runtime-descriptor-immutability.mjs'

const read = path => JSON.parse(readFileSync(path, 'utf8'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const snapshot = read('.github/fixtures/strata/legacy-snapshot.json')
const current = () => read('models/catalog.json')
const withoutStrata = () => {
  const data = current()
  for (const [id, model] of Object.entries(data.models)) if (['strata', 'strata-cuda'].includes(model.kind)) delete data.models[id]
  delete data.collections['strata-models']
  delete data.collections['strata-cuda-models']
  return data
}

test('strata-catalog-compat: existing catalog and every legacy export retain the pinned base bytes', () => {
  assert.equal(hash(canonicalJSON(withoutStrata())), snapshot.catalog_without_strata_sha256)
  for (const [path, expected] of Object.entries(snapshot.legacy_files)) {
    assert.equal(hash(readFileSync(path)), expected, path)
    const name = path.slice('models/'.length, -'.json'.length)
    assert.deepEqual(projectCollection(current(), name), read(path), name)
  }
})

test('strata-catalog-compat: exact released core 0.21.2 reader accepts Strata and unknown kinds', () => {
  assert.equal(hash(readFileSync(snapshot.reader.path)), snapshot.reader.sha256)
  const data = current(), baseline = withoutStrata()
  data.models['future-test'] = { kind: 'future', format: 'future', variants: { default: {} }, definition: {} }
  data.collections['future-test'] = { header: { schema_version: 1 }, entries: [{ model: 'future-test', variant: 'default' }] }
  assert.doesNotThrow(() => parseAtomicModelCatalog(data))
  for (const path of Object.keys(snapshot.legacy_files)) {
    const name = path.slice('models/'.length, -'.json'.length)
    assert.deepEqual(projectAtomicModelCollection(data, name), projectAtomicModelCollection(baseline, name), name)
  }
})

test('strata-catalog-compat: new reader accepts the old catalog without a Strata collection', () => {
  const data = validateCatalog(withoutStrata())
  assert.deepEqual(projectStrata(data), { schema_version: 1, models: [] })
  assert.equal(projectStrata(validateCatalog(current())).models.length, 35)
})

test('strata-catalog-compat: documented file URLs read the real empty release manifest and candidate catalog', () => {
  const manifest = read(pathToFileURL(resolve('backends/strata-manifest.json')))
  assert.deepEqual(manifest.releases, [])
  const data = validateCatalog(read(pathToFileURL(resolve('models/catalog.json'))))
  assert.equal(projectStrata(data).models.length, 35)
})

test('strata-catalog-compat: older Strata readers retain their six definitions', () => {
  const data = current()
  for (const ref of data.collections['strata-models'].entries) {
    assert.equal(data.models[ref.model].kind, 'strata')
  }
  const projected = projectStrata({ ...data, collections: { 'strata-models': data.collections['strata-models'] } })
  assert.equal(projected.models.length, 6)
})
