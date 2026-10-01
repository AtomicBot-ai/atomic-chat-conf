import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  ENVIRONMENT_MANIFEST_PATH,
  checkManifestImmutability,
  readJsonAtRef,
} from './runtime-descriptor-immutability.mjs'

// manifest_id immutability: a published manifest_id's content must never
// change — core caches an accepted environment manifest by this id and pins
// an operation to the id the user consented to, so editing a published
// manifest in place (e.g. adding a distribution) would silently change the
// plan under a running operation (see README "manifest_id is immutable").
// This compares the working tree's runtimes/environments/linux.json against
// the same file read from a base git ref. The base ref is shared with the
// descriptor check: one variable for everything under runtimes/.

const manifest = JSON.parse(
  readFileSync(new URL(`../../${ENVIRONMENT_MANIFEST_PATH}`, import.meta.url), 'utf8')
)
const clone = (value) => JSON.parse(JSON.stringify(value))

const BASE_REF = process.env.RUNTIME_DESCRIPTOR_BASE_REF || 'origin/main'

test('immutability: same manifest_id + same content -> ok', () => {
  assert.equal(checkManifestImmutability(manifest, clone(manifest)).ok, true)
})

test('immutability: same manifest_id + another distribution -> fail', () => {
  const changed = clone(manifest)
  changed.recipes[0].distributions.push({ id: 'ubuntu', version_id: '28.04', arch: 'x86_64' })
  const result = checkManifestImmutability(manifest, changed)
  assert.equal(result.ok, false)
  assert.match(result.reason, /manifest_id "linux-r1"/)
  assert.match(result.reason, /immutable/)
})

test('immutability: new manifest_id -> ok even though content also differs', () => {
  const changed = clone(manifest)
  changed.manifest_id = 'linux-r2'
  changed.recipes[0].distributions.push({ id: 'ubuntu', version_id: '28.04', arch: 'x86_64' })
  assert.equal(checkManifestImmutability(manifest, changed).ok, true)
})

test('immutability: absent base manifest -> ok', () => {
  assert.equal(checkManifestImmutability(null, manifest).ok, true)
})

test('readJsonAtRef: a ref without the manifest file is treated as absent', () => {
  // The root commit of this repository predates runtimes/ entirely.
  const root = spawnSync('git', ['rev-list', '--max-parents=0', 'HEAD'], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    encoding: 'utf8',
  })
    .stdout.trim()
    .split('\n')[0]
  assert.match(root, /^[0-9a-f]{40}$/)
  assert.equal(readJsonAtRef(root, ENVIRONMENT_MANIFEST_PATH), null)
  assert.equal(readJsonAtRef('', ENVIRONMENT_MANIFEST_PATH), null)
})

test('end to end through git: an edited manifest under a committed manifest_id fails against HEAD', () => {
  // HEAD carries a committed linux.json; this proves the git read and the
  // comparison work together for this path, independent of whether the base
  // ref below has the file yet.
  const committed = readJsonAtRef('HEAD', ENVIRONMENT_MANIFEST_PATH)
  if (committed === null) {
    console.log('  HEAD has no committed manifest yet — nothing to compare, passing')
    return
  }
  const edited = clone(committed)
  edited.recipes[0].distributions.pop()
  assert.equal(checkManifestImmutability(committed, edited).ok, false)
})

test(`manifest_id immutability against base ref "${BASE_REF}" (env RUNTIME_DESCRIPTOR_BASE_REF, default origin/main)`, () => {
  const base = readJsonAtRef(BASE_REF, ENVIRONMENT_MANIFEST_PATH)
  if (base === null) {
    console.log(`  base ref/file absent at "${BASE_REF}" — nothing to compare, passing`)
    return
  }
  const result = checkManifestImmutability(base, manifest)
  assert.equal(result.ok, true, result.reason)
})
