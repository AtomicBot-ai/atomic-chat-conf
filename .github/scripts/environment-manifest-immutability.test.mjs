import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  ENVIRONMENT_MANIFEST_PATHS,
  checkManifestImmutability,
  readJsonAtRef,
} from './runtime-descriptor-immutability.mjs'

// manifest_id immutability: a published manifest_id's content must never
// change — core caches an accepted environment manifest by this id and pins
// an operation (Linux) or an imported environment (Windows) to it, so editing
// a published manifest in place (e.g. adding a distribution, swapping the
// rootfs) would silently change what core acts on (see README "manifest_id is
// immutable"). This compares the working tree's runtimes/environments/*.json
// against the same files read from a base git ref. The base ref is shared
// with the descriptor check: one variable for everything under runtimes/.

const clone = (value) => JSON.parse(JSON.stringify(value))

const BASE_REF = process.env.RUNTIME_DESCRIPTOR_BASE_REF || 'origin/main'

// A content change that keeps the manifest valid, per platform: what an
// editor would most plausibly try to slip in under the same manifest_id.
const EDITS = {
  linux: (m) => m.recipes[0].distributions.push({ id: 'ubuntu', version_id: '28.04', arch: 'x86_64' }),
  windows: (m) => {
    m.rootfs.url = m.rootfs.url.replace('24.04.5', '24.04.6')
    m.rootfs.sha256 = '0'.repeat(64)
  },
}

test('every environment manifest under runtimes/environments/ is covered', () => {
  assert.deepEqual(
    ENVIRONMENT_MANIFEST_PATHS.map((path) => path.match(/([a-z]+)\.json$/)[1]).sort(),
    Object.keys(EDITS).sort()
  )
})

for (const path of ENVIRONMENT_MANIFEST_PATHS) {
  const manifest = JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'))
  const edit = EDITS[manifest.platform]
  const id = manifest.manifest_id

  test(`${path} immutability: same manifest_id + same content -> ok`, () => {
    assert.equal(checkManifestImmutability(manifest, clone(manifest)).ok, true)
  })

  test(`${path} immutability: same manifest_id + edited content -> fail`, () => {
    const changed = clone(manifest)
    edit(changed)
    const result = checkManifestImmutability(manifest, changed)
    assert.equal(result.ok, false)
    assert.match(result.reason, new RegExp(`manifest_id "${id}"`))
    assert.match(result.reason, /immutable/)
  })

  test(`${path} immutability: new manifest_id -> ok even though content also differs`, () => {
    const changed = clone(manifest)
    changed.manifest_id = id.replace(/-r([0-9]+)$/, (_, n) => `-r${Number(n) + 1}`)
    edit(changed)
    assert.equal(checkManifestImmutability(manifest, changed).ok, true)
  })

  test(`${path} immutability: absent base manifest -> ok`, () => {
    assert.equal(checkManifestImmutability(null, manifest).ok, true)
  })

  test(`${path} readJsonAtRef: a ref without the manifest file is treated as absent`, () => {
    // The root commit of this repository predates runtimes/ entirely.
    const root = spawnSync('git', ['rev-list', '--max-parents=0', 'HEAD'], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      encoding: 'utf8',
    })
      .stdout.trim()
      .split('\n')[0]
    assert.match(root, /^[0-9a-f]{40}$/)
    assert.equal(readJsonAtRef(root, path), null)
    assert.equal(readJsonAtRef('', path), null)
  })

  test(`${path} end to end through git: an edited manifest under a committed manifest_id fails against HEAD`, () => {
    // HEAD carries the committed manifest once it is published; this proves
    // the git read and the comparison work together for this path,
    // independent of whether the base ref below has the file yet.
    const committed = readJsonAtRef('HEAD', path)
    if (committed === null) {
      console.log(`  HEAD has no committed ${path} yet — nothing to compare, passing`)
      return
    }
    const edited = clone(committed)
    edit(edited)
    assert.equal(checkManifestImmutability(committed, edited).ok, false)
  })

  test(`${path} manifest_id immutability against base ref "${BASE_REF}" (env RUNTIME_DESCRIPTOR_BASE_REF, default origin/main)`, () => {
    const base = readJsonAtRef(BASE_REF, path)
    if (base === null) {
      console.log(`  base ref/file absent at "${BASE_REF}" — nothing to compare, passing`)
      return
    }
    const result = checkManifestImmutability(base, manifest)
    assert.equal(result.ok, true, result.reason)
  })
}
