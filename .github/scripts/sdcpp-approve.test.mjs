import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { fakeGhPath } from '../fixtures/sdcpp/gh.mjs'
import { DOWNLOAD_BASE, LIVE, STAGING, liveManifest, stagedRefusals } from './sdcpp-approve.mjs'

// staging.json is the live manifest of master-883-137f740-a36f1b1a and
// releases/ holds what the GitHub API says about that release here.
const fixture = (path) => JSON.parse(readFileSync(new URL(`../fixtures/sdcpp/${path}`, import.meta.url), 'utf8'))
const TAG = 'master-883-137f740-a36f1b1a'
const staged = fixture('staging.json')
const release = fixture(`releases/${TAG}.json`)
const withAsset = (name, patch) => ({
  ...staged,
  assets: staged.assets.map((a) => (a.name === name ? { ...a, ...patch } : a)),
})
const MAC = 'sd-master-137f740-bin-Darwin-macOS-26.6.2-arm64.zip'

test('a staging manifest whose archives are the release goes live', () => {
  assert.deepEqual(stagedRefusals(staged, TAG, release), [])
})

test('the staging manifest must name the tag and point at this repository', () => {
  assert.deepEqual(stagedRefusals(staged, 'master-890-1a2b3c4-a5d6e7f8', release), [
    `${STAGING} names ${TAG}, not master-890-1a2b3c4-a5d6e7f8`,
  ])
  const elsewhere = { ...staged, download_base: 'https://github.com/AtomicBot-ai/stable-diffusion.cpp/releases/download' }
  assert.match(stagedRefusals(elsewhere, TAG, release)[0], new RegExp(`not ${DOWNLOAD_BASE}`))
  assert.deepEqual(stagedRefusals({ ...staged, assets: [] }, TAG, release), ['the manifest lists no archives'])
})

test('every listed archive is in the release with its size and sha256', () => {
  assert.deepEqual(stagedRefusals(withAsset(MAC, { size: 1 }), TAG, release), [
    `${MAC}: 1 bytes listed, 34338631 released`,
  ])
  const otherHash = '0'.repeat(64)
  assert.deepEqual(stagedRefusals(withAsset(MAC, { sha256: otherHash }), TAG, release), [
    `${MAC}: sha256:${otherHash} listed, sha256:56a8e614bec7a9659875020e2d3d78fcd5fc53765044ff38c868bfaf3ff3e395 released`,
  ])
  const gone = { ...release, assets: release.assets.filter((a) => a.name !== MAC) }
  assert.deepEqual(stagedRefusals(staged, TAG, gone), [`${MAC} is not in release ${TAG}`])
  const undigested = { ...release, assets: release.assets.map((a) => ({ ...a, digest: a.name === MAC ? null : a.digest })) }
  assert.match(stagedRefusals(staged, TAG, undigested)[0], /listed, no digest released$/)
  // An extra archive in the release is not the manifest's business.
  const extra = { ...release, assets: [...release.assets, { name: 'notes.txt', size: 1, digest: 'sha256:00' }] }
  assert.deepEqual(stagedRefusals(staged, TAG, extra), [])
})

test('the live manifest is the staged one with a new updated_at', () => {
  const live = liveManifest(staged, '2026-10-20T13:00:00Z')
  assert.equal(live.updated_at, '2026-10-20T13:00:00Z')
  assert.deepEqual({ ...live, updated_at: staged.updated_at }, staged)
  assert.deepEqual(Object.keys(live), Object.keys(staged))
})

test('the CLI checks and approves the staging manifest of a commit on the branch', (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'sdcpp-approve-'))
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
  writeFileSync(join(repo, LIVE), '{}\n')
  const checked = commit(staged, 'mirror the candidate')
  // A newer candidate takes the slot before the approval.
  commit({ ...staged, tag_name: 'master-890-1a2b3c4-a5d6e7f8' }, 'mirror the next candidate')
  git('checkout', '-qb', 'side')
  const side = commit(staged, 'staged on a branch only')
  git('checkout', '-q', 'main')

  const script = fileURLToPath(new URL('./sdcpp-approve.mjs', import.meta.url))
  const env = { ...process.env, PATH: fakeGhPath() }
  const cli = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: 'utf8', env })

  const check = cli('check', '--tag', TAG, '--conf-sha', checked)
  assert.equal(check.status, 0, check.stderr)
  assert.match(check.stdout, /14 archive\(s\) match the release/)

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
  assert.match(wrongTag.stderr, /::error::.*names master-890-1a2b3c4-a5d6e7f8, not master-883-137f740-a36f1b1a/)
  assert.equal(cli('approve', '--tag', TAG, '--conf-sha', head).status, 1)

  const unreleased = cli('check', '--tag', 'master-890-1a2b3c4-a5d6e7f8', '--conf-sha', head)
  assert.equal(unreleased.status, 1)
  assert.match(unreleased.stderr, /Not Found/)

  assert.match(cli('check', '--tag', 'master-883-137f740', '--conf-sha', checked).stderr, /--tag must look like/)
  assert.match(cli('check', '--tag', TAG, '--conf-sha', checked.slice(0, 7)).stderr, /--conf-sha must be a 40-character/)
  assert.equal(cli('promote', '--tag', TAG).status, 2)
})
