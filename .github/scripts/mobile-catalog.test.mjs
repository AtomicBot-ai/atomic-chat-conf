import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'
import { checkMobileCatalog } from './mobile-catalog-check.mjs'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = (path) => JSON.parse(readFileSync(join(REPO_ROOT, path), 'utf8'))
const catalog = read('models/mobile.json')
const clone = (value) => JSON.parse(JSON.stringify(value))
const scratch = mkdtempSync(join(tmpdir(), 'mobile-catalog-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

const ajv = (dataPath) => {
  const result = spawnSync('npx', [
    '--yes', 'ajv-cli@5', 'validate', '-s', 'models/schema.mobile.json',
    '-d', dataPath, '--strict=false',
  ], { cwd: REPO_ROOT, encoding: 'utf8' })
  if (result.error) throw result.error
  return result
}

const ajvOnCopy = (name, mutate) => {
  const copy = clone(catalog)
  const payload = mutate(copy) ?? copy
  const path = join(scratch, `${name}.json`)
  writeFileSync(path, JSON.stringify(payload))
  return ajv(path)
}

test('both published catalogs pass schema and integrity checks', () => {
  const result = ajv('models/mobile*.json')
  assert.equal(result.status, 0, result.stderr)
  for (const path of ['models/mobile.json', 'models/mobile-dev.json']) {
    assert.deepEqual(checkMobileCatalog(read(path)), [], path)
  }
})

const INVALID_SCHEMA = {
  'bare-array': (c) => c.models,
  'unknown-version': (c) => { c.schema_version = 2 },
  'legacy-onboarding-list': (c) => { c.onboardingModelIds = [] },
  'apple-engine': (c) => { c.models[0].engine = 'apple' },
  'desktop-engine': (c) => { c.models[0].engine = 'sdcpp' },
  'desktop-platform': (c) => { c.models[0].platforms = ['macos'] },
  'empty-platforms': (c) => { c.models[0].platforms = [] },
  'duplicate-platforms': (c) => { c.models[0].platforms = ['ios', 'ios'] },
  'missing-projector-size': (c) => { delete c.models[0].mmprojSize },
  'orphan-projector-size': (c) => { c.models[0].mmprojRemoteId = null },
  'missing-size': (c) => { delete c.models[0].size },
  'fractional-size': (c) => { c.models[0].size = 1.5 },
  'unsafe-integer-size': (c) => { c.models[0].size = 9007199254740992 },
  'unknown-badge-tone': (c) => { c.models[0].badges = [{ label: 'vision', tone: 'red' }] },
  'insecure-icon': (c) => { c.models[0].iconUrl = 'http://example.com/icon.png' },
  'coreml-on-android': (c) => { c.models[0].engine = 'coreml-diffusion' },
}

for (const field of ['path', 'status', 'progress', 'mmprojLocalPath', 'createdAt', 'updatedAt']) {
  INVALID_SCHEMA[`remote-${field}`] = (c) => { c.models[0][field] = null }
}

for (const [name, mutate] of Object.entries(INVALID_SCHEMA)) {
  test(`schema rejects ${name}`, () => {
    const result = ajvOnCopy(name, mutate)
    assert.notEqual(result.status, 0, `${name} unexpectedly passed: ${result.stdout}`)
    assert.match(result.stderr, /invalid/, result.stderr)
  })
}

test('schema accepts explicit MLX and CoreML artifacts and optional metadata', () => {
  const result = ajvOnCopy('apple-artifacts', (c) => {
    c.models = ['mlx', 'coreml-diffusion'].map((engine) => ({
      id: engine === 'mlx' ? 'owner/mlx-repo' : 'owner/coreml-repo/model.zip',
      name: engine,
      description: 'Explicit mobile artifact',
      iconUrl: 'https://example.com/icon.png',
      engine,
      size: 1024,
      mmprojRemoteId: null,
      badges: [{ label: 'mobile' }],
      platforms: ['ios'],
      categories: ['general'],
    }))
  })
  assert.equal(result.status, 0, result.stderr)
})

test('platform omission and false execution flags are valid', () => {
  const result = ajvOnCopy('both-platforms', (c) => {
    delete c.models[0].platforms
    c.models[0].forceCpu = false
    c.models[0].supportsThinking = false
  })
  assert.equal(result.status, 0, result.stderr)
})

const INVALID_INTEGRITY = {
  'duplicate-id': [(c) => { c.models.push(clone(c.models[0])) }, /Duplicate model id/],
  'impossible-date': [(c) => { c.updated_at = '2026-02-30T00:00:00Z' }, /updated_at/],
  'malformed-date': [(c) => { c.updated_at = 'yesterday' }, /updated_at/],
  'repo-instead-of-file': [(c) => { c.models[0].id = 'owner/repo' }, /exact GGUF/],
  'unsafe-model-id': [(c) => { c.models[0].id = 'owner/repo/../model.gguf' }, /unsafe remote id/],
  'unsafe-projector-id': [(c) => { c.models[0].mmprojRemoteId = 'owner/repo/./mmproj.gguf' }, /unsafe remote id/],
  'projector-repo': [(c) => { c.models[0].mmprojRemoteId = 'owner/repo' }, /exact GGUF/],
  'same-projector': [(c) => { c.models[0].mmprojRemoteId = c.models[0].id }, /different artifacts/],
  'local-apple-id': [(c) => { c.models[0].id = 'apple/intelligence' }, /injected locally/],
  'desktop-diffusion-file': [(c) => {
    c.models[0].engine = 'coreml-diffusion'
    c.models[0].id = 'owner/repo/model.safetensors'
  }, /CoreML/],
  'malformed-https-icon': [(c) => { c.models[0].iconUrl = 'https://?' }, /iconUrl/],
}

for (const [name, [mutate, message]] of Object.entries(INVALID_INTEGRITY)) {
  test(`integrity rejects ${name}`, () => {
    const copy = clone(catalog)
    mutate(copy)
    assert.match(checkMobileCatalog(copy).join('\n'), message)
  })
}

test('onboarding, thinking and CPU flags stay explicit, independent of categories', () => {
  const copy = clone(catalog)
  copy.models = [copy.models[0]]
  copy.models[0].categories = ['reasoning']
  copy.models[0].isOnboarding = false
  copy.models[0].supportsThinking = false
  copy.models[0].forceCpu = false
  const before = clone(copy)
  assert.deepEqual(checkMobileCatalog(copy), [])
  assert.deepEqual(copy, before)
})
