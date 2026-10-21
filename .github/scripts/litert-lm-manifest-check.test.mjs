import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { checkManifest, checkPublishedReleases } from './litert-lm-manifest-check.mjs'

// Each broken copy is made from the real manifest, so these tests also break
// if the manifest itself stops passing.
const manifest = JSON.parse(
  readFileSync(new URL('../../backends/litert-lm-manifest.json', import.meta.url), 'utf8')
)
const copy = () => structuredClone(manifest)

// A second, older release, the shape a real update produces.
function withOlderRelease() {
  const data = copy()
  const older = structuredClone(data.releases[0])
  older.version = '0.18.0'
  older.published_at = '2026-10-01T00:00:00Z'
  for (const a of older.assets) a.name = a.name.replace('0.18.1', '0.18.0')
  data.releases.push(older)
  return data
}

test('the published manifest passes', () => {
  assert.deepEqual(checkManifest(manifest), [])
  assert.deepEqual(checkManifest(withOlderRelease()), [])
})

test('a release without one of the four platforms fails', () => {
  const data = copy()
  data.releases[0].assets = data.releases[0].assets.filter((a) => a.platform !== 'linux-arm64')
  assert.match(checkManifest(data).join('\n'), /missing platform linux-arm64/)
})

test('a duplicate platform, asset name or version fails', () => {
  let data = copy()
  data.releases[0].assets.push({ ...data.releases[0].assets[0], name: 'litert_lm_api-0.18.1-other.whl' })
  assert.match(checkManifest(data).join('\n'), /duplicate platform macos-arm64/)

  data = copy()
  data.releases[0].assets[1].name = data.releases[0].assets[0].name
  assert.match(checkManifest(data).join('\n'), /duplicate asset name/)

  data = withOlderRelease()
  data.releases[1].version = data.releases[0].version
  assert.match(checkManifest(data).join('\n'), /Duplicate release version: 0\.18\.1/)
})

test('releases out of newest-first order fail', () => {
  const data = withOlderRelease()
  data.releases.reverse()
  assert.match(checkManifest(data).join('\n'), /is newer than 0\.18\.0 above it/)
})

test('an accelerator outside win-x64 or listed twice fails', () => {
  let data = copy()
  data.releases[0].accelerators[0].platform = 'linux-x64'
  assert.match(checkManifest(data).join('\n'), /accelerators are win-x64 only/)

  data = copy()
  data.releases[0].accelerators.push(data.releases[0].accelerators[0])
  assert.match(checkManifest(data).join('\n'), /duplicate accelerator openvino/)
})

test('a published release changed in place fails against the base', () => {
  const data = copy()
  data.releases[0].assets[0].sha256 = '0'.repeat(64)
  assert.match(checkPublishedReleases(manifest, data).join('\n'), /Release 0\.18\.1 is published with different content/)
})

test('a new release on top, a removed release, reordered keys and no base all pass', () => {
  const base = withOlderRelease()

  const added = withOlderRelease()
  added.releases.unshift({ ...structuredClone(added.releases[0]), version: '0.18.2', published_at: '2026-11-01T00:00:00Z' })
  assert.deepEqual(checkPublishedReleases(base, added), [])

  const removed = withOlderRelease()
  removed.releases.splice(1, 1)
  assert.deepEqual(checkPublishedReleases(base, removed), [])

  const reordered = withOlderRelease()
  reordered.releases[0] = Object.fromEntries(Object.entries(reordered.releases[0]).reverse())
  assert.deepEqual(checkPublishedReleases(base, reordered), [])

  assert.deepEqual(checkPublishedReleases(null, manifest), [])
})
