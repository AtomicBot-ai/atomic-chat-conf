import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  addRelease,
  approveRelease,
  backendForAsset,
  buildOf,
  checkPrismManifest,
  checkPrismModels,
  cudaRequirements,
  prismGateRefusal,
  releaseEntry,
  withdrawRelease,
} from './prism-manifest.mjs'

const TAG = 'prism-b10754-2459f68'
const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))

test('maps every desktop asset of a PrismML release to its backend id', () => {
  const cases = [
    [`llama-${TAG}-bin-macos-arm64.tar.gz`, 'macos-arm64'],
    [`llama-${TAG}-bin-macos-x64.tar.gz`, 'macos-x64'],
    [`llama-${TAG}-bin-ubuntu-x64.tar.gz`, 'linux-cpu-x64'],
    [`llama-${TAG}-bin-ubuntu-vulkan-x64.tar.gz`, 'linux-vulkan-x64'],
    [`llama-${TAG}-bin-linux-cuda-12.8-x64.tar.gz`, 'linux-cuda-12.8-x64'],
    [`llama-${TAG}-bin-ubuntu-rocm-7.2-x64.tar.gz`, 'linux-rocm-7.2-x64'],
    [`llama-${TAG}-bin-win-cuda-13.3-x64.zip`, 'win-cuda-13.3-x64'],
    [`llama-${TAG}-bin-win-hip-radeon-x64.zip`, 'win-hip-radeon-x64'],
    ['cudart-llama-bin-win-cuda-12.4-x64.zip', 'win-cudart-12.4-x64'],
  ]
  for (const [name, backend] of cases) assert.equal(backendForAsset(name, TAG)?.backend, backend, name)
  assert.equal(backendForAsset('cudart-llama-bin-win-cuda-12.4-x64.zip', TAG)?.companion, true)
})

test('skips assets the desktop app does not ship', () => {
  for (const name of [
    `llama-${TAG}-bin-android-arm64.tar.gz`,
    `llama-${TAG}-bin-macos-arm64-kleidiai.tar.gz`,
    `llama-${TAG}-bin-ubuntu-arm64.tar.gz`,
    `llama-${TAG}-bin-win-cpu-arm64.zip`,
    `llama-${TAG}-bin-win-cuda-13.4-arm64.zip`,
    'cudart-llama-bin-win-cuda-13.4-arm64.zip',
    `llama-${TAG}-xcframework.zip`,
    `llama-${TAG}-bin-win-cpu-x64.tar.gz`,
    `llama-prism-b1-0000000-bin-macos-arm64.tar.gz`,
  ]) {
    assert.equal(backendForAsset(name, TAG), null, name)
  }
})

test('gates CUDA packs like the core does', () => {
  assert.deepEqual(cudaRequirements('win-cuda-12.4-x64'), {
    min_driver: '551.61',
    companion_backend: 'win-cudart-12.4-x64',
  })
  assert.deepEqual(cudaRequirements('linux-cuda-13.3-x64'), {
    min_driver: '580',
    min_compute_capability: '7.5',
  })
  assert.deepEqual(cudaRequirements('linux-vulkan-x64'), {})
})

const release = {
  tag_name: TAG,
  target_commitish: '2459f68b5c0eb26261fd5a81682004b93cd645ba',
  published_at: '2026-10-02T21:15:26Z',
  assets: [
    { name: `llama-${TAG}-bin-win-cuda-12.4-x64.zip`, size: 3, digest: `sha256:${'a'.repeat(64)}` },
    { name: 'cudart-llama-bin-win-cuda-12.4-x64.zip', size: 2, digest: `sha256:${'b'.repeat(64)}` },
    { name: `llama-${TAG}-bin-android-arm64.tar.gz`, size: 1, digest: `sha256:${'c'.repeat(64)}` },
  ],
}

test('builds a candidate entry that passes the integrity check', () => {
  const entry = releaseEntry(release)
  assert.deepEqual(
    entry.assets.map((a) => [a.backend, a.validation]),
    [
      ['win-cuda-12.4-x64', 'candidate'],
      ['win-cudart-12.4-x64', 'candidate'],
    ]
  )
  assert.equal(entry.notes_url, `https://github.com/PrismML-Eng/llama.cpp/releases/tag/${TAG}`)
  const manifest = { upstream_repo: 'PrismML-Eng/llama.cpp', releases: [entry] }
  assert.deepEqual(checkPrismManifest(manifest), [])
})

test('refuses a release asset without a published sha256', () => {
  const unhashed = { ...release, assets: [{ ...release.assets[0], digest: null }] }
  assert.throws(() => releaseEntry(unhashed), /no sha256/)
  assert.throws(() => releaseEntry({ ...release, tag_name: 'b10754' }), /Not a PrismML release tag/)
})

test('adds a release newest first and is idempotent', () => {
  const old = { ...releaseEntry(release), tag: 'prism-b10743-adfffbe', commit: 'adfffbe' + '0'.repeat(33) }
  const base = { releases: [old], updated_at: 'then' }
  const first = addRelease(base, releaseEntry(release), 'now')
  assert.equal(first.added, true)
  assert.deepEqual(first.manifest.releases.map((r) => r.tag), [TAG, 'prism-b10743-adfffbe'])
  assert.equal(first.manifest.updated_at, 'now')
  const again = addRelease(first.manifest, releaseEntry(release), 'later')
  assert.equal(again.added, false)
  assert.equal(again.manifest.updated_at, 'now')
  assert.equal(buildOf(TAG), 10754)
})

test('catches what the schema cannot', () => {
  const entry = releaseEntry(release)
  const approvedWithoutCompanion = {
    upstream_repo: 'PrismML-Eng/llama.cpp',
    releases: [
      {
        ...entry,
        assets: entry.assets.map((a) => (a.companion ? a : { ...a, validation: 'approved' })),
      },
    ],
  }
  assert.match(checkPrismManifest(approvedWithoutCompanion).join('\n'), /approved companion/)
  const missingCompanion = {
    upstream_repo: 'PrismML-Eng/llama.cpp',
    releases: [{ ...entry, assets: entry.assets.filter((a) => !a.companion) }],
  }
  assert.match(checkPrismManifest(missingCompanion).join('\n'), /needs win-cudart-12.4-x64/)
  const wrongOrder = { upstream_repo: 'PrismML-Eng/llama.cpp', releases: [entry, entry] }
  assert.match(checkPrismManifest(wrongOrder).join('\n'), /Duplicate release/)
  const badCommit = { upstream_repo: 'PrismML-Eng/llama.cpp', releases: [{ ...entry, commit: 'f'.repeat(40) }] }
  assert.match(checkPrismManifest(badCommit).join('\n'), /does not match the tag/)
})

test('approves every asset of a listed release, companions included, and is idempotent', () => {
  const base = { upstream_repo: 'PrismML-Eng/llama.cpp', releases: [releaseEntry(release)], updated_at: 'then' }
  const first = approveRelease(base, TAG, { minCoreVersion: '0.19.0' }, 'now')
  assert.equal(first.changed, true)
  const [approved] = first.manifest.releases
  assert.equal(approved.min_core_version, '0.19.0')
  assert.deepEqual(approved.assets.map((a) => a.validation), ['approved', 'approved'])
  assert.equal(first.manifest.updated_at, 'now')
  assert.deepEqual(checkPrismManifest(first.manifest), [])
  // A re-run changes nothing, not even updated_at
  const again = approveRelease(first.manifest, TAG, { minCoreVersion: '0.19.0' }, 'later')
  assert.equal(again.changed, false)
  assert.equal(approveRelease(first.manifest, TAG, {}, 'later').changed, false)
  // A newer core floor is still a change
  assert.equal(approveRelease(first.manifest, TAG, { minCoreVersion: '0.20.0' }, 'later').changed, true)
})

test('refuses to approve what is not listed, is withdrawn or has a bad core version', () => {
  const base = { releases: [releaseEntry(release)] }
  assert.throws(() => approveRelease(base, 'prism-b1-0000000', {}, 'now'), /not listed/)
  assert.throws(() => approveRelease(base, TAG, { minCoreVersion: 'v0.19' }, 'now'), /must look like/)
  const withdrawn = withdrawRelease(base, TAG, 'crashes on load', 'now').manifest
  assert.deepEqual(withdrawn.releases[0].withdrawn, { reason: 'crashes on load' })
  assert.throws(() => approveRelease(withdrawn, TAG, {}, 'now'), /withdrawn: crashes on load/)
  assert.throws(() => withdrawRelease(base, TAG, '', 'now'), /needs a --reason/)
})

test('the gate wants a successful engine-candidate run that names the tag', () => {
  const run = (displayTitle, conclusion, createdAt = '2026-10-20T08:00:00Z') => ({
    displayTitle,
    conclusion,
    status: 'completed',
    createdAt,
    url: `https://gh/${createdAt}`,
  })
  const title = `engine-candidate atomic-prism ${TAG} [cid:conf-${TAG}-hb-1] core@v0.19.0`
  assert.equal(prismGateRefusal([run(title, 'success')], TAG), null)
  assert.match(prismGateRefusal([], TAG), /no engine-candidate run names it/)
  assert.match(prismGateRefusal([run(title, 'failure')], TAG), /concluded failure/)
  // Another build of the fork does not count
  const other = `engine-candidate atomic-prism prism-b10743-adfffbe [cid:x] core@main`
  assert.match(prismGateRefusal([run(other, 'success')], TAG), /no engine-candidate run names it/)
})

test('model rules need one default, a replacement for legacy files and no duplicates', () => {
  const family = (files) => ({ families: [{ id: 'f', repo: 'o/r', files }], tensor_types: { 42: 'q2_0' } })
  const good = { file: 'a.gguf', treatment: 'prism_required', requires: ['pq2_0'], default: true, packing: 'pq2_0' }
  assert.deepEqual(checkPrismModels(family([good])), [])
  assert.match(checkPrismModels(family([{ ...good, default: false }])).join('\n'), /exactly one file/)
  assert.match(
    checkPrismModels(family([good, { file: 'b.gguf', treatment: 'legacy', packing: 'q2_0_legacy' }])).join('\n'),
    /must name its replacement/
  )
  assert.match(checkPrismModels(family([good, good])).join('\n'), /Duplicate file/)
  assert.match(checkPrismModels(family([{ ...good, requires: [] }])).join('\n'), /non-empty requires/)
})

test('the published manifests pass their integrity checks', () => {
  const manifest = read('../../backends/atomic-prism-manifest.json')
  assert.deepEqual(checkPrismManifest(manifest), [])
  assert.deepEqual(checkPrismModels(read('../../models/atomic-prism-models.json')), [])
  // Every asset is candidate or approved: there is no third state
  for (const r of manifest.releases) {
    for (const a of r.assets) assert.ok(['candidate', 'approved'].includes(a.validation))
  }
})
