import { refreshCatalogSource } from './refresh-model-catalog.mjs'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { validateCatalog, projectCollection } from './model-catalog.mjs'
const catalog = JSON.parse(readFileSync(new URL('../../models/catalog.json', import.meta.url), 'utf8'))

test('every legacy export preserves the published shape and values', () => {
  validateCatalog(catalog)
  for (const name of Object.keys(catalog.collections)) {
    const old = JSON.parse(readFileSync(new URL(`../../models/${name}.json`, import.meta.url), 'utf8'))
    assert.deepEqual(projectCollection(catalog, name), old)
  }
})
test('references and immutable sources are required', () => {
  const broken = structuredClone(catalog)
  broken.collections['staff-picks'].entries.push({ model: 'missing-model', variant: 'default' })
  assert.throws(() => validateCatalog(broken), /Unknown model reference/)
  const unpinned = structuredClone(catalog)
  const model = Object.values(unpinned.models).find(m => m.kind === 'chat')
  model.definition.revision = 'main'
  assert.throws(() => validateCatalog(unpinned), /Missing immutable revision/)
})
test('recommendations reference the single model definition', () => {
  const modelId = catalog.collections.recommended.recommendations[0].model
  assert.equal(typeof modelId, 'string')
  assert.equal(catalog.collections.recommended.recommendations[0].model_name, undefined)
  assert.equal(projectCollection(catalog, 'recommended').recommendations[0].model_name, catalog.models[modelId].definition.model_name)
})
test('new clients retain independent pins while old clients receive their original fields', () => {
  const family = projectCollection(catalog, 'diffusion', true).families[0]
  assert.match(family.transformer.revision, /^[0-9a-f]{40}$/)
  assert.match(family.vae.revision, /^[0-9a-f]{40}$/)
  assert.notEqual(family.transformer.revision, family.vae.revision)
  const old = projectCollection(catalog, 'diffusion').families[0]
  assert.equal(old.vae.revision, undefined)
  assert.equal(old.transformer.revision, family.transformer.revision)
})

test('generation is reproducible and an independently edited export fails CI', () => {
  const directory = mkdtempSync(join(tmpdir(), 'atomic-catalog-'))
  const run = (...args) => spawnSync(process.execPath, [new URL('./export-model-catalog.mjs', import.meta.url).pathname, '--directory', directory, ...args], { encoding: 'utf8' })
  try {
    writeFileSync(join(directory, 'catalog.json'), JSON.stringify(catalog))
    assert.equal(run().status, 0)
    const first = Object.keys(catalog.collections).map(name => readFileSync(join(directory, `${name}.json`), 'utf8'))
    assert.equal(run().status, 0)
    assert.deepEqual(Object.keys(catalog.collections).map(name => readFileSync(join(directory, `${name}.json`), 'utf8')), first)
    assert.equal(run('--check').status, 0)
    const edited = JSON.parse(first[0])
    edited.updated_at = '2000-01-01T00:00:00Z'
    writeFileSync(join(directory, `${Object.keys(catalog.collections)[0]}.json`), JSON.stringify(edited))
    assert.equal(run('--check').status, 1)
    assert.equal(run().status, 0)
    assert.equal(run('--check').status, 0)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('the explicit updater obtains sizes and content hashes at the selected commit', async () => {
  const original = structuredClone(catalog)
  const id = original.collections['staff-picks'].entries[0].model
  const model = original.models[id]
  const repo = model.definition.model_name
  const revision = 'b'.repeat(40)
  model.files = [{ path: 'config.json', size: 3, sha256: 'f'.repeat(64) }]
  const request = async url => String(url).includes('/api/models/')
    ? Response.json({ sha: revision, siblings: [{ rfilename: 'config.json', size: 2 }] })
    : new Response('{}')
  const updated = await refreshCatalogSource(original, id, repo, revision, { fetch: request, now: () => new Date('2026-11-01T00:00:00Z') })
  assert.equal(updated.models[id].definition.revision, revision)
  assert.equal(updated.models[id].files[0].size, 2)
  assert.equal(updated.models[id].files[0].sha256, createHash('sha256').update('{}').digest('hex'))
  assert.equal(updated.collections['staff-picks'].header.updated_at, updated.updated_at)
  assert.equal(original.models[id].files[0].size, 3)
  await assert.rejects(refreshCatalogSource(original, id, repo, revision, { fetch: async () => Response.json({ sha: 'c'.repeat(40) }) }), /another commit/)
})

// Captured from this exact HF tree on 2026-11-02; Kimi K2.6 has one weight file.
test('the Kimi draft refresh accepts its pinned file layout and refuses missing required shards', async () => {
  const id = 'auxiliary:mlx-dflash:kimi-k2.6'
  const revision = '3401c5c9bbd1e1989529bc36a334fa3d3d39691d'
  const metadata = {
    sha: revision,
    siblings: [
      { rfilename: 'config.json', size: 1326 },
      { rfilename: 'model.safetensors', size: 6958561592, lfs: {
        size: 6958561592, sha256: '9a6003bc678a24364d5d4ec1e6e23fa0e616e68c5ef3cc59725a622f56125f66',
      } },
    ],
  }
  const repo = 'z-lab/Kimi-K2.6-DFlash'
  const request = async url => {
    assert.equal(String(url), `https://huggingface.co/api/models/${repo}/revision/${revision}?blobs=true&files_metadata=true`)
    return Response.json(metadata)
  }
  assert.equal(catalog.models[id].definition.revision, revision)
  const updated = await refreshCatalogSource(catalog, id, repo, revision, { fetch: request })
  assert.deepEqual(updated.models[id].definition.required, metadata.siblings.map(file => file.rfilename))
  const broken = structuredClone(catalog)
  broken.models[id].definition.required.push('model-00001-of-00003.safetensors')
  await assert.rejects(refreshCatalogSource(broken, id, repo, revision, { fetch: request }), /Missing required model-00001-of-00003/)
})

test('the audio export preserves its pinned source and refreshes the repository path, not the local filename', async () => {
  const id = 'audio:qwen3-tts-1.7b-customvoice'
  const model = catalog.models[id].definition
  const quant = model.quants[0]
  const metadata = { sha: model.revision, siblings: [{ rfilename: quant.path, lfs: { size: quant.bytes, sha256: quant.sha256 } }] }
  const updated = await refreshCatalogSource(catalog, id, model.repo, model.revision, { fetch: async () => Response.json(metadata) })
  assert.equal(updated.models[id].definition.quants[0].sha256, quant.sha256)
  assert.deepEqual(projectCollection(updated, 'audio').models.find(m => m.id === model.id).quants, model.quants)
})
