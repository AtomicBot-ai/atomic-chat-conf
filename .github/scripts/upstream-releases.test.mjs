import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  ANY_CORE,
  approve,
  archivesFromRelease,
  checkReleases,
  compareVersions,
  emptyList,
  hashArchives,
  keepTags,
  promote,
  pruneList,
  releaseEntry,
  replaces,
  rerunRefusal,
  upsertCandidate,
  withdraw,
} from './upstream-releases.mjs'

const NOW = '2026-10-13T10:00:00Z'
const LATER = '2026-10-14T10:00:00Z'
const SHA = (c) => c.repeat(64)
const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))

const upstream = (tag) => ({
  tag_name: tag,
  target_commitish: 'd2a79e60464903f9832fbecdba48bd4cc6c47e75',
  published_at: '2026-10-07T10:40:25Z',
})
const archives = (tag, suffixes, sha = 'a') =>
  suffixes.map((suffix) => ({ name: `llama-${tag}-bin-${suffix}`, sha256: SHA(sha), size: 100 }))
const listed = (tag, suffixes, options = {}) =>
  upsertCandidate(emptyList(NOW), releaseEntry(upstream(tag), archives(tag, suffixes), options), NOW)
const release = (list, tag) => list.releases.find((r) => r.tag === tag)
const legacyFor = (list, tag) => promote(list, tag, NOW).manifest

test('lists a mirrored tag with every archive a candidate, newest first, for every core', () => {
  const first = listed('b11463', ['win-cpu-x64.zip', 'macos-arm64.tar.gz'])
  const entry = releaseEntry(upstream('b11500'), [
    ...archives('b11500', ['macos-arm64.tar.gz']),
    { name: 'cudart-llama-bin-win-cuda-12.4-x64.zip', sha256: SHA('b'), size: 1 },
  ])
  const list = upsertCandidate(first, entry, LATER)
  assert.deepEqual(
    list.releases.map((r) => r.tag),
    ['b11500', 'b11463']
  )
  assert.equal(list.updated_at, LATER)
  const added = release(list, 'b11500')
  assert.equal(added.min_core_version, ANY_CORE)
  assert.equal(added.notes_url, 'https://github.com/ggml-org/llama.cpp/releases/tag/b11500')
  assert.deepEqual(
    added.assets.map((a) => [a.name, a.validation]),
    [['llama-b11500-bin-macos-arm64.tar.gz', 'candidate']]
  )
  assert.deepEqual(
    release(first, 'b11463').assets.map((a) => a.name),
    ['llama-b11463-bin-macos-arm64.tar.gz', 'llama-b11463-bin-win-cpu-x64.zip']
  )
})

test('refuses entries it cannot pin', () => {
  assert.throws(() => releaseEntry({ ...upstream('b1'), tag_name: 'master-1' }, []), /Not a ggml-org/)
  assert.throws(() => releaseEntry({ ...upstream('b1'), target_commitish: 'master' }, []), /full commit sha/)
  assert.throws(() => releaseEntry(upstream('b1'), archives('b2', ['macos-arm64.tar.gz'])), /No llama-b1-bin-/)
  assert.throws(
    () => releaseEntry(upstream('b1'), archives('b1', ['macos-arm64.tar.gz']), { minCoreVersion: '0.16' }),
    /min-core-version/
  )
  assert.throws(() => archivesFromRelease({ assets: [{ name: 'x', size: 1 }] }), /no sha256 digest/)
  assert.deepEqual(archivesFromRelease({ assets: [{ name: 'x', size: 1, digest: `sha256:${SHA('c')}` }] }), [
    { name: 'x', sha256: SHA('c'), size: 1 },
  ])
})

test('a re-run replaces a candidate and keeps what was decided about it', () => {
  let list = listed('b11500', ['macos-arm64.tar.gz'], { minCoreVersion: '0.16.0' })
  list = { ...list, releases: [{ ...list.releases[0], notes: 'needs the 0.16 tokenizer fix' }] }
  const rerun = releaseEntry(upstream('b11500'), archives('b11500', ['macos-arm64.tar.gz'], 'f'))
  const next = upsertCandidate(list, rerun, LATER)
  const entry = release(next, 'b11500')
  assert.equal(entry.assets[0].sha256, SHA('f'))
  assert.equal(entry.min_core_version, '0.16.0')
  assert.equal(entry.notes, 'needs the 0.16 tokenizer fix')
})

test('a re-run over approved bits is refused', () => {
  const list = approve(listed('b11463', ['macos-arm64.tar.gz']), 'b11463', {}, NOW)
  assert.match(rerunRefusal(list, 'b11463'), /1 approved asset/)
  assert.equal(rerunRefusal(list, 'b99999'), null)
  assert.equal(rerunRefusal(listed('b11463', ['macos-arm64.tar.gz']), 'b11463'), null)
  const rerun = releaseEntry(upstream('b11463'), archives('b11463', ['macos-arm64.tar.gz'], 'f'))
  assert.throws(() => upsertCandidate(list, rerun, LATER), /re-signs every archive/)
})

test('approves all assets or the named ones, optionally for a newer core', () => {
  const list = listed('b11500', ['macos-arm64.tar.gz', 'win-rocm-10.0-x64.zip'])
  const some = approve(list, 'b11500', { only: ['llama-b11500-bin-macos-arm64.tar.gz'], minCoreVersion: '0.16.0' }, LATER)
  const entry = release(some, 'b11500')
  assert.equal(entry.min_core_version, '0.16.0')
  assert.deepEqual(
    entry.assets.map((a) => a.validation),
    ['approved', 'candidate']
  )
  assert.ok(release(approve(list, 'b11500', {}, LATER), 'b11500').assets.every((a) => a.validation === 'approved'))
  assert.throws(() => approve(list, 'b11500', { only: ['nope.zip'] }, LATER), /no asset nope.zip/)
  assert.throws(() => approve(list, 'b1', {}, LATER), /not listed/)
  const pulled = withdraw(list, 'b11500', 'crashes on load', 'b11463', LATER)
  assert.throws(() => approve(pulled, 'b11500', {}, LATER), /withdrawn: crashes on load/)
})

test('promoting points the legacy manifest at the listed bytes, for every core', () => {
  const list = listed('b11500', ['win-cuda-12.4-x64.zip', 'macos-arm64.tar.gz'], { minCoreVersion: '0.16.0' })
  const { list: next, manifest } = promote(list, 'b11500', LATER)
  assert.equal(release(next, 'b11500').min_core_version, ANY_CORE)
  assert.equal(manifest.tag_name, 'b11500')
  assert.equal(manifest.download_base, list.download_base)
  assert.deepEqual(
    manifest.assets.map((a) => a.name),
    [
      'llama-b11500-bin-macos-arm64.tar.gz',
      'llama-b11500-bin-win-cuda-12.4-x64.zip',
      'cudart-llama-bin-win-cuda-12.4-x64.zip',
    ]
  )
  assert.deepEqual(checkReleases(next, manifest), [])
})

test('the release older cores follow cannot be withdrawn', () => {
  const list = listed('b11463', ['macos-arm64.tar.gz'])
  assert.throws(() => withdraw(list, 'b11463', 'bad', 'b11463', LATER), /promote another release/)
  assert.throws(() => withdraw(list, 'b11463', '', 'b1', LATER), /--reason/)
  assert.deepEqual(release(withdraw(list, 'b11463', 'bad', 'b1', LATER), 'b11463').withdrawn, { reason: 'bad' })
})

test('a newer release replaces an older one only when it serves every core and backend the older did', () => {
  const approved = (tag, suffixes, minCoreVersion = ANY_CORE) =>
    release(approve(listed(tag, suffixes), tag, { minCoreVersion }, NOW), tag)
  const candidate = (tag, suffixes) => release(listed(tag, suffixes), tag)
  const older = approved('b11463', ['macos-arm64.tar.gz', 'win-cpu-x64.zip'])

  assert.equal(replaces(approved('b11500', ['macos-arm64.tar.gz', 'win-cpu-x64.zip', 'ubuntu-x64.tar.gz']), older), true)
  assert.equal(replaces(approved('b11500', ['macos-arm64.tar.gz']), older), false)
  assert.equal(replaces(approved('b11500', ['macos-arm64.tar.gz', 'win-cpu-x64.zip'], '0.16.0'), older), false)
  assert.equal(replaces(candidate('b11500', ['macos-arm64.tar.gz', 'win-cpu-x64.zip']), older), false)
  assert.equal(replaces({ ...approved('b11500', ['macos-arm64.tar.gz', 'win-cpu-x64.zip']), withdrawn: { reason: 'x' } }, older), false)
  // A fresh mirror retires the previous candidate.
  assert.equal(replaces(candidate('b11500', ['macos-arm64.tar.gz']), candidate('b11480', ['macos-arm64.tar.gz'])), true)
})

test('prune drops replaced releases but never the legacy manifest tag', () => {
  let list = listed('b11463', ['macos-arm64.tar.gz'])
  list = approve(list, 'b11463', {}, NOW)
  list = upsertCandidate(list, releaseEntry(upstream('b11480'), archives('b11480', ['macos-arm64.tar.gz'])), NOW)
  list = upsertCandidate(list, releaseEntry(upstream('b11500'), archives('b11500', ['macos-arm64.tar.gz'])), NOW)
  list = approve(list, 'b11500', {}, NOW)

  const { list: pruned, dropped } = pruneList(list, new Set(['b11463']), LATER)
  assert.deepEqual(dropped, [{ tag: 'b11480', by: 'b11500' }])
  assert.deepEqual(
    pruned.releases.map((r) => r.tag),
    ['b11500', 'b11463']
  )
  assert.equal(pruned.updated_at, LATER)
  const unchanged = pruneList(pruned, new Set(['b11463']), LATER)
  assert.deepEqual(unchanged.dropped, [])
  assert.equal(unchanged.list, pruned)
  assert.deepEqual(
    pruneList(pruned, new Set(), LATER).dropped,
    [{ tag: 'b11463', by: 'b11500' }]
  )
})

test('keeps the mirrored releases of every listed tag that is not withdrawn', () => {
  let list = listed('b11463', ['macos-arm64.tar.gz'])
  list = upsertCandidate(list, releaseEntry(upstream('b11500'), archives('b11500', ['macos-arm64.tar.gz'])), NOW)
  list = withdraw(list, 'b11500', 'bad', 'b11463', NOW)
  assert.deepEqual(keepTags(list, { tag_name: 'b11400' }), ['b11400', 'b11463'])
})

test('the legacy manifest has to name an approved release every core runs, byte for byte', () => {
  const list = approve(listed('b11463', ['macos-arm64.tar.gz', 'win-cpu-x64.zip']), 'b11463', {}, NOW)
  const legacy = legacyFor(list, 'b11463')
  assert.deepEqual(checkReleases(list, legacy), [])

  const errors = (l, m = legacy) => checkReleases(l, m).join('\n')
  assert.match(errors(list, { ...legacy, tag_name: 'b1' }), /names b1, which is not listed/)
  assert.match(errors(approve(list, 'b11463', { minCoreVersion: '0.16.0' }, NOW)), /needs core 0.16.0/)
  const pulled = { ...list, releases: [{ ...list.releases[0], withdrawn: { reason: 'x' } }] }
  assert.match(errors(pulled), /which is withdrawn/)
  const changed = { ...legacy, assets: legacy.assets.map((a) => ({ ...a, sha256: SHA('e') })) }
  assert.match(errors(list, changed), /sha256 or size differ/)
  assert.match(errors(listed('b11463', ['macos-arm64.tar.gz', 'win-cpu-x64.zip'])), /not approved/)
  const extra = { ...legacy, assets: [...legacy.assets, { name: 'llama-b11463-bin-ubuntu-x64.tar.gz', sha256: SHA('a'), size: 100 }] }
  assert.match(errors(list, extra), /ubuntu-x64.tar.gz is in backends\/manifest.json but not listed/)
  assert.match(errors(list, { ...legacy, download_base: 'https://example.com' }), /download_base must match/)
})

test('checks ordering, duplicates and tags the schema cannot', () => {
  const list = approve(listed('b11463', ['macos-arm64.tar.gz']), 'b11463', {}, NOW)
  const legacy = legacyFor(list, 'b11463')
  const older = { ...list.releases[0], tag: 'b11400', assets: [{ ...list.releases[0].assets[0] }] }
  const errors = (releases) => checkReleases({ ...list, releases }, legacy).join('\n')
  assert.match(errors([older, list.releases[0]]), /newest first/)
  assert.match(errors([list.releases[0], list.releases[0]]), /Duplicate release/)
  assert.match(errors([list.releases[0], older]), /belongs to another tag/)
  const twice = { ...list.releases[0], assets: [list.releases[0].assets[0], list.releases[0].assets[0]] }
  assert.match(errors([twice]), /duplicate asset/)
  assert.match(errors([{ ...list.releases[0], published_at: 'yesterday' }]), /published_at/)
})

test('orders versions numerically', () => {
  assert.equal(compareVersions('0.15.0', '0.9.9'), 1)
  assert.equal(compareVersions('0.15.0', '0.15.0'), 0)
  assert.equal(compareVersions('0.0.0', '0.15.0'), -1)
})

test('hashes the mirrored archives of a tag and nothing else', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'upstream-releases-'))
  try {
    writeFileSync(join(dir, 'llama-b11463-bin-macos-arm64.tar.gz'), 'mac')
    writeFileSync(join(dir, 'llama-b11400-bin-macos-arm64.tar.gz'), 'old')
    writeFileSync(join(dir, 'notes.md'), 'x')
    assert.deepEqual(await hashArchives(dir, 'b11463'), [
      {
        name: 'llama-b11463-bin-macos-arm64.tar.gz',
        sha256: '348a629f5ceed032c3e8706ec47d9bfafb00fb4250b018dd965435ca50cb836e',
        size: 3,
      },
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the published list passes its integrity checks against the published manifest', () => {
  const list = read('../../backends/llamacpp-upstream-releases.json')
  assert.deepEqual(checkReleases(list, read('../../backends/manifest.json')), [])
})
