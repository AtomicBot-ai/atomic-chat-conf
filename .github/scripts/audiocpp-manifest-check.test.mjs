import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { STAGING, checkManifest } from './audiocpp-manifest-check.mjs'

// The schema, run through ajv exactly as `make validate` runs it, and the
// integrity checks as pure functions, against the real staging manifest (the
// upstream bootstrap: no download_base) and a mirrored one (the approval
// fixture), plus broken copies of both.
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SCHEMA = 'backends/audiocpp-schema.json'
const upstream = JSON.parse(readFileSync(join(REPO_ROOT, STAGING), 'utf8'))
const mirrored = JSON.parse(readFileSync(new URL('../fixtures/audiocpp/staging.json', import.meta.url), 'utf8'))
const edit = (manifest, mutate) => {
  const data = structuredClone(manifest)
  mutate(data)
  return data
}
const asset = (data, backend) => data.assets.find((a) => a.backend === backend)

test('the staging manifest and a mirrored one pass', () => {
  assert.deepEqual(checkManifest(upstream), [])
  assert.deepEqual(checkManifest(mirrored), [])
})

test('the integrity checks say what is wrong', () => {
  const cases = [
    [(m) => { m.tag_name = 'v0.9.2-drama3-base-small' }, /tag_name must look like an audio.cpp release tag/],
    [(m) => { m.download_base = 'http://example.com' }, /download_base, if present, must be an https URL/],
    [(m) => { m.assets = [] }, /assets must be a non-empty array/],
    [(m) => { m.assets.push({ ...asset(m, 'win-cpu-x64'), name: 'other.zip' }) }, /Duplicate backend id: win-cpu-x64/],
    [(m) => { asset(m, 'win-cpu-x64').name = asset(m, 'win-vulkan-x64').name }, /Duplicate asset name/],
    [(m) => { asset(m, 'win-cpu-x64').name = 'win cpu.7z' }, /"win-cpu-x64" has a malformed name/],
    [(m) => { delete asset(m, 'win-cpu-x64').size }, /"win-cpu-x64" must declare sha256 and size together/],
    [(m) => { delete asset(m, 'win-cudart-cu12').companion }, /"win-cudart-cu12" companion flag does not match its id/],
    [(m) => { asset(m, 'win-cpu-x64').companion = true }, /"win-cpu-x64" companion flag does not match its id/],
    [(m) => { m.assets = m.assets.filter((a) => a.backend !== 'linux-vulkan-x64') }, /Missing required backend: linux-vulkan-x64/],
    [(m) => { m.assets = m.assets.filter((a) => a.backend !== 'win-cudart-cu12') }, /win-cuda12-x64 needs its win-cudart-cu12 companion/],
  ]
  for (const [mutate, message] of cases) {
    const errors = checkManifest(edit(upstream, mutate))
    assert.ok(errors.some((e) => message.test(e)), `${message} not in ${JSON.stringify(errors)}`)
  }
  // Unhashed archives are tolerated from upstream, never from this repository.
  const unhashed = (m) => { delete asset(m, 'macos-arm64').sha256; delete asset(m, 'macos-arm64').size }
  assert.deepEqual(checkManifest(edit(upstream, unhashed)), [])
  assert.deepEqual(checkManifest(edit(mirrored, unhashed)), [
    'Asset "macos-arm64" is served from download_base but carries no sha256',
  ])
})

test('the schema accepts both manifests and refuses broken copies', (t) => {
  const scratch = mkdtempSync(join(tmpdir(), 'audiocpp-manifest-'))
  t.after(() => rmSync(scratch, { recursive: true, force: true }))
  const copies = {
    'ok-upstream': upstream,
    'ok-mirrored': mirrored,
    'ok-bare-tag': edit(mirrored, (m) => { m.tag_name = 'v0.9.3' }),
    'bad-tag': edit(upstream, (m) => { m.tag_name = 'v0.9.2-drama3-base-small' }),
    'bad-repo': edit(upstream, (m) => { m.upstream_repo = 'leejet/stable-diffusion.cpp' }),
    'bad-no-repo': edit(upstream, (m) => { delete m.upstream_repo }),
    'bad-rocm': edit(mirrored, (m) => { asset(m, 'linux-cpu-arm64').backend = 'linux-rocm-7.14-x64' }),
    'bad-no-sha256': edit(upstream, (m) => { delete asset(m, 'macos-arm64').sha256 }),
    'bad-no-size': edit(upstream, (m) => { delete asset(m, 'macos-arm64').size }),
    'bad-companion-missing': edit(upstream, (m) => { delete asset(m, 'win-cudart-cu12').companion }),
    'bad-companion-elsewhere': edit(upstream, (m) => { asset(m, 'win-cpu-x64').companion = true }),
    'bad-name': edit(upstream, (m) => { asset(m, 'win-cpu-x64').name = 'win-cpu.7z' }),
    'bad-extra-field': edit(upstream, (m) => { m.min_core_version = '0.21.0' }),
  }
  for (const [name, data] of Object.entries(copies)) writeFileSync(join(scratch, `${name}.json`), JSON.stringify(data))
  const result = spawnSync(
    'npx',
    ['--yes', 'ajv-cli@5', 'validate', '-s', SCHEMA, '-d', join(scratch, '*.json'), '--strict=false'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
  if (result.error) throw new Error(`Could not launch "npx": ${result.error.message}`)
  const output = `${result.stdout}\n${result.stderr}`
  for (const name of Object.keys(copies)) {
    const verdict = name.startsWith('ok-') ? 'valid' : 'invalid'
    assert.match(output, new RegExp(`${name}\\.json ${verdict}\\b`), `${name}: expected ${verdict}\n${output}`)
  }
  t.diagnostic(`${Object.keys(copies).length} copies through ajv`)
})
