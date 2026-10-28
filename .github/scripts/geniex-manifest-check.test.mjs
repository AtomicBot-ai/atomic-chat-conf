import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'
import { checkManifest, checkPublishedReleases } from './geniex-manifest-check.mjs'

// Two halves, both run by `make validate` and CI:
// - the schema, run through ajv exactly as `make validate` runs it, against
//   the real manifest and against broken copies (the core loads this zip's
//   DLLs into its own process, so the schema's host and hash rules are the
//   whole defence);
// - the integrity checks as pure functions.
//
// Each broken copy is made from the real manifest, so these tests also break
// if the manifest itself stops passing.
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SCHEMA = 'backends/geniex-schema.json'
const MANIFEST = 'backends/geniex-manifest.json'
const manifest = JSON.parse(readFileSync(join(REPO_ROOT, MANIFEST), 'utf8'))
const copy = () => structuredClone(manifest)

const scratch = mkdtempSync(join(tmpdir(), 'geniex-manifest-'))
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

const ajvOnCopy = (name, mutate) => {
  const data = copy()
  mutate(data)
  const path = join(scratch, `${name}.json`)
  writeFileSync(path, JSON.stringify(data))
  return ajv(path)
}

// A second, older release, the shape a real update produces.
function withOlderRelease() {
  const data = copy()
  const older = structuredClone(data.releases[0])
  older.version = '0.9.2'
  older.published_at = '2026-10-01T00:00:00Z'
  for (const a of older.assets) a.name = a.name.replace('0.9.3', '0.9.2')
  data.releases.push(older)
  return data
}

const SCHEMA_BROKEN = {
  'no-sha256': (m) => { delete m.releases[0].assets[0].sha256 },
  'no-size': (m) => { delete m.releases[0].assets[0].size },
  'other-host': (m) => { m.releases[0].assets[0].url = 'https://example.com/geniex-sdk-windows-arm64-v0.9.3.zip' },
  'unknown-platform': (m) => { m.releases[0].assets[0].platform = 'linux-arm64' },
  'extra-field': (m) => { m.releases[0].assets[0].mirror = 'github' },
  'extra-release-field': (m) => { m.releases[0].htp_signed = true },
  'no-abi': (m) => { delete m.releases[0].abi },
  'bad-asset-name': (m) => { m.releases[0].assets[0].name = 'geniex-cli-setup-windows-arm64-v0.9.3.exe' },
}

test('the real manifest passes the schema', () => {
  const result = ajv(MANIFEST)
  assert.equal(result.status, 0, result.stderr)
})

test('a GitHub release URL passes the schema', () => {
  const result = ajvOnCopy('github-url', (m) => {
    m.releases[0].assets[0].url = 'https://github.com/qualcomm/GenieX/releases/download/v0.9.3/geniex-sdk-windows-arm64-v0.9.3.zip'
  })
  assert.equal(result.status, 0, result.stderr)
})

for (const [name, mutate] of Object.entries(SCHEMA_BROKEN)) {
  test(`schema rejects a copy with ${name}`, () => {
    const result = ajvOnCopy(name, mutate)
    assert.notEqual(result.status, 0, `ajv accepted the ${name} copy`)
  })
}

test('the published manifest passes the integrity checks', () => {
  assert.deepEqual(checkManifest(manifest), [])
  assert.deepEqual(checkManifest(withOlderRelease()), [])
})

test('a release without the win-arm64 asset fails', () => {
  const data = copy()
  data.releases[0].assets = []
  assert.match(checkManifest(data).join('\n'), /missing platform win-arm64/)
})

test('a duplicate platform, asset name or version fails', () => {
  let data = copy()
  data.releases[0].assets.push({ ...data.releases[0].assets[0], name: 'geniex-sdk-windows-arm64-cpu-v0.9.3.zip' })
  assert.match(checkManifest(data).join('\n'), /duplicate platform win-arm64/)

  data = copy()
  data.releases[0].assets.push({ ...data.releases[0].assets[0], platform: 'linux-arm64' })
  assert.match(checkManifest(data).join('\n'), /duplicate asset name/)

  data = withOlderRelease()
  data.releases[1].version = data.releases[0].version
  assert.match(checkManifest(data).join('\n'), /Duplicate release version: 0\.9\.3/)
})

test('releases out of newest-first order fail', () => {
  const data = withOlderRelease()
  data.releases.reverse()
  assert.match(checkManifest(data).join('\n'), /is newer than 0\.9\.2 above it/)
})

test('a published release changed in place fails against the base', () => {
  const data = copy()
  data.releases[0].assets[0].sha256 = '0'.repeat(64)
  assert.match(checkPublishedReleases(manifest, data).join('\n'), /Release 0\.9\.3 is published with different content/)
})

test('a new release on top, a removed release, reordered keys and no base all pass', () => {
  const base = withOlderRelease()

  const added = withOlderRelease()
  added.releases.unshift({ ...structuredClone(added.releases[0]), version: '0.9.4', published_at: '2026-11-01T00:00:00Z' })
  assert.deepEqual(checkPublishedReleases(base, added), [])

  const removed = withOlderRelease()
  removed.releases.splice(1, 1)
  assert.deepEqual(checkPublishedReleases(base, removed), [])

  const reordered = withOlderRelease()
  reordered.releases[0] = Object.fromEntries(Object.entries(reordered.releases[0]).reverse())
  assert.deepEqual(checkPublishedReleases(base, reordered), [])

  assert.deepEqual(checkPublishedReleases(null, manifest), [])
})
