import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { fakeGhPath } from '../fixtures/audiocpp/gh.mjs'
import { DOWNLOAD_BASE, LIVE, STAGING, TAG_RE, liveManifest, stagedRefusals } from './audiocpp-approve.mjs'

// staging.json is a staging manifest of the fork build v0.9.3-a1b2c3d4 as
// mirror-audiocpp.yml writes it, and releases/ holds what the GitHub API says
// about that release here.
const fixture = (path) => JSON.parse(readFileSync(new URL(`../fixtures/audiocpp/${path}`, import.meta.url), 'utf8'))
const TAG = 'v0.9.3-a1b2c3d4'
const staged = fixture('staging.json')
const release = fixture(`releases/${TAG}.json`)
const withAsset = (name, patch) => ({
  ...staged,
  assets: staged.assets.map((a) => (a.name === name ? { ...a, ...patch } : a)),
})
const MAC = 'audio-v0.9.3-bin-macos-arm64.zip'
const macDigest = release.assets.find((a) => a.name === MAC).digest

test('approves fork builds and bare tags, nothing else', () => {
  for (const tag of ['v0.9.3', 'v0.9.3-a1b2c3d4', 'v10.20.300-a0000000']) assert.match(tag, TAG_RE)
  for (const tag of ['0.9.3', 'v0.9', 'v0.9.3-a1b2c3', 'v0.9.3-A1B2C3D', 'v0.9.2-drama3-base-small', 'master-883-137f740']) {
    assert.doesNotMatch(tag, TAG_RE)
  }
})

test('a staging manifest whose archives are the release goes live', () => {
  assert.deepEqual(stagedRefusals(staged, TAG, release), [])
})

test('the staging manifest must name the tag and point at this repository', () => {
  assert.deepEqual(stagedRefusals(staged, 'v0.9.4-a2b3c4d5', release), [`${STAGING} names ${TAG}, not v0.9.4-a2b3c4d5`])
  // The upstream bootstrap manifest downloads from 0xShug0/audio.cpp: its
  // archives are not the ones signed here.
  const { download_base: _, ...upstream } = staged
  assert.deepEqual(stagedRefusals(upstream, TAG, release), [`download_base is undefined, not ${DOWNLOAD_BASE}`])
  assert.deepEqual(stagedRefusals({ ...staged, assets: [] }, TAG, release), ['the manifest lists no archives'])
})

test('every listed archive is in the release with its size and sha256', () => {
  const size = release.assets.find((a) => a.name === MAC).size
  assert.deepEqual(stagedRefusals(withAsset(MAC, { size: 1 }), TAG, release), [`${MAC}: 1 bytes listed, ${size} released`])
  const otherHash = '0'.repeat(64)
  assert.deepEqual(stagedRefusals(withAsset(MAC, { sha256: otherHash }), TAG, release), [
    `${MAC}: sha256:${otherHash} listed, ${macDigest} released`,
  ])
  const gone = { ...release, assets: release.assets.filter((a) => a.name !== MAC) }
  assert.deepEqual(stagedRefusals(staged, TAG, gone), [`${MAC} is not in release ${TAG}`])
  const undigested = { ...release, assets: release.assets.map((a) => ({ ...a, digest: a.name === MAC ? null : a.digest })) }
  assert.match(stagedRefusals(staged, TAG, undigested)[0], /listed, no digest released$/)
  // SHA256SUMS is in the release and not in the manifest: not the manifest's business.
  assert.ok(release.assets.some((a) => a.name === 'SHA256SUMS'))
})

test('the live manifest is the staged one with a new updated_at', () => {
  const live = liveManifest(staged, '2026-10-29T13:00:00Z')
  assert.equal(live.updated_at, '2026-10-29T13:00:00Z')
  assert.deepEqual({ ...live, updated_at: staged.updated_at }, staged)
  assert.deepEqual(Object.keys(live), Object.keys(staged))
})

test('the CLI checks and approves the staging manifest of a commit on the branch', (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'audiocpp-approve-'))
  t.after(() => rmSync(repo, { recursive: true, force: true }))
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], {
      cwd: repo,
      encoding: 'utf8',
    }).trim()
  const commit = (manifest, message) => {
    writeFileSync(join(repo, STAGING), `${JSON.stringify(manifest, null, 2)}\n`)
    git('add', '-A')
    git('commit', '-qm', message)
    return git('rev-parse', 'HEAD')
  }
  git('init', '-q', '-b', 'main')
  mkdirSync(join(repo, 'backends'))
  // No live manifest yet: the first approval creates it.
  const checked = commit(staged, 'mirror the candidate')
  // A newer candidate takes the slot before the approval.
  commit({ ...staged, tag_name: 'v0.9.4-a2b3c4d5' }, 'mirror the next candidate')
  git('checkout', '-qb', 'side')
  const side = commit(staged, 'staged on a branch only')
  git('checkout', '-q', 'main')

  const script = fileURLToPath(new URL('./audiocpp-approve.mjs', import.meta.url))
  const env = { ...process.env, PATH: fakeGhPath() }
  const cli = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: 'utf8', env })

  const check = cli('check', '--tag', TAG, '--conf-sha', checked)
  assert.equal(check.status, 0, check.stderr)
  assert.match(check.stdout, new RegExp(`${staged.assets.length} archive\\(s\\) match the release`))

  assert.equal(existsSync(join(repo, LIVE)), false)
  const approve = cli('approve', '--tag', TAG, '--conf-sha', checked)
  assert.equal(approve.status, 0, approve.stderr)
  const live = JSON.parse(readFileSync(join(repo, LIVE), 'utf8'))
  assert.equal(live.tag_name, TAG)
  assert.deepEqual({ ...live, updated_at: staged.updated_at }, staged)
  assert.notEqual(live.updated_at, staged.updated_at)

  const offBranch = cli('check', '--tag', TAG, '--conf-sha', side)
  assert.equal(offBranch.status, 1)
  assert.match(offBranch.stderr, /is not a commit of this branch/)

  const head = git('rev-parse', 'HEAD')
  const wrongTag = cli('check', '--tag', TAG, '--conf-sha', head)
  assert.equal(wrongTag.status, 1)
  assert.match(wrongTag.stderr, /::error::.*names v0\.9\.4-a2b3c4d5, not v0\.9\.3-a1b2c3d4/)
  assert.equal(cli('approve', '--tag', TAG, '--conf-sha', head).status, 1)

  const unreleased = cli('check', '--tag', 'v0.9.4-a2b3c4d5', '--conf-sha', head)
  assert.equal(unreleased.status, 1)
  assert.match(unreleased.stderr, /Not Found/)

  assert.match(cli('check', '--tag', 'v0.9.2-drama3-base-small', '--conf-sha', checked).stderr, /--tag must look like/)
  assert.match(cli('check', '--tag', TAG, '--conf-sha', checked.slice(0, 7)).stderr, /--conf-sha must be a 40-character/)
  assert.equal(cli('promote', '--tag', TAG).status, 2)
})
