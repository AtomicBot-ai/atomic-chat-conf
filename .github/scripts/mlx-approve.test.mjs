import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { fakeGhPath } from '../fixtures/mlx/gh.mjs'
import { LIVE, STAGING, TAG_RE, stagedRefusals } from './mlx-approve.mjs'
import { MIRROR_REPO } from './upstream-releases.mjs'

// staging.json is a staging manifest of the mirrored build
// mlxvlm-macos-arm64-a1b2c3d as mirror-mlx.yml writes it, and releases/ holds
// what the GitHub API says about that release here.
const fixture = (path) => JSON.parse(readFileSync(new URL(`../fixtures/mlx/${path}`, import.meta.url), 'utf8'))
const TAG = 'mlxvlm-macos-arm64-a1b2c3d'
const staged = fixture('staging.json')
const release = fixture(`releases/${TAG}.json`)
const ASSET = 'mlxvlm-mlx-server-macos-arm64.tar.gz'
const digest = release.assets.find((a) => a.name === ASSET).digest
const withAsset = (patch) => ({ ...staged, assets: [{ ...staged.assets[0], ...patch }] })

test('approves mirrored builds only, in the form released cores accept', () => {
  for (const tag of ['mlxvlm-macos-arm64-a1b2c3d', 'mlxvlm-macos-arm64-0000000']) assert.match(tag, TAG_RE)
  for (const tag of ['v0.7.12', 'mlxvlm-macos-arm64-a1b2c3', 'mlxvlm-macos-arm64-A1B2C3D', 'mlxvlm-macos-arm64-07ba5a19', 'v0.7.12-aa1b2c3d']) {
    assert.doesNotMatch(tag, TAG_RE)
  }
})

test('a staging manifest whose archive is the release goes live', () => {
  assert.deepEqual(stagedRefusals(staged, TAG, release), [])
})

test('the staging manifest must name the tag and download from this repository', () => {
  assert.deepEqual(stagedRefusals(staged, 'mlxvlm-macos-arm64-b2c3d4e', release), [
    `${STAGING} names ${TAG}, not mlxvlm-macos-arm64-b2c3d4e`,
  ])
  // Builds before the mirror download from the fork: its archive is not the one checked here.
  assert.deepEqual(stagedRefusals({ ...staged, upstream_repo: 'AtomicBot-ai/mlx-vlm' }, TAG, release), [
    `upstream_repo is AtomicBot-ai/mlx-vlm, not ${MIRROR_REPO}`,
  ])
  assert.deepEqual(stagedRefusals({ ...staged, assets: [] }, TAG, release), ['the manifest lists no archive'])
})

test('the archive is in the release with its size and sha256', () => {
  const size = release.assets.find((a) => a.name === ASSET).size
  assert.deepEqual(stagedRefusals(withAsset({ size: 1 }), TAG, release), [`${ASSET}: 1 bytes listed, ${size} released`])
  const otherHash = '0'.repeat(64)
  assert.deepEqual(stagedRefusals(withAsset({ sha256: otherHash }), TAG, release), [
    `${ASSET}: sha256:${otherHash} listed, ${digest} released`,
  ])
  const gone = { ...release, assets: release.assets.filter((a) => a.name !== ASSET) }
  assert.deepEqual(stagedRefusals(staged, TAG, gone), [`${ASSET} is not in release ${TAG}`])
  // requirements.lock.txt is in the release and not in the manifest: not the manifest's business.
  assert.ok(release.assets.some((a) => a.name === 'requirements.lock.txt'))
})

test('the CLI checks and approves the staging manifest of a commit on the branch', (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'mlx-approve-'))
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
  writeFileSync(join(repo, LIVE), '{"tag_name": "mlxvlm-macos-arm64-07ba5a1"}\n')
  const checked = commit(staged, 'mirror the candidate')
  // A newer candidate takes the slot before the approval.
  commit({ ...staged, tag_name: 'mlxvlm-macos-arm64-b2c3d4e' }, 'mirror the next candidate')
  git('checkout', '-qb', 'side')
  const side = commit(staged, 'staged on a branch only')
  git('checkout', '-q', 'main')

  const script = fileURLToPath(new URL('./mlx-approve.mjs', import.meta.url))
  const env = { ...process.env, PATH: fakeGhPath() }
  const cli = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: 'utf8', env })

  const check = cli('check', '--tag', TAG, '--conf-sha', checked)
  assert.equal(check.status, 0, check.stderr)
  assert.match(check.stdout, /1 archive\(s\) match the release/)

  const approve = cli('approve', '--tag', TAG, '--conf-sha', checked)
  assert.equal(approve.status, 0, approve.stderr)
  // The live manifest is the checked staging manifest byte for byte: no field the schema forbids.
  assert.deepEqual(JSON.parse(readFileSync(join(repo, LIVE), 'utf8')), staged)

  const offBranch = cli('check', '--tag', TAG, '--conf-sha', side)
  assert.equal(offBranch.status, 1)
  assert.match(offBranch.stderr, /is not a commit of this branch/)

  const head = git('rev-parse', 'HEAD')
  const wrongTag = cli('check', '--tag', TAG, '--conf-sha', head)
  assert.equal(wrongTag.status, 1)
  assert.match(wrongTag.stderr, /::error::.*names mlxvlm-macos-arm64-b2c3d4e, not mlxvlm-macos-arm64-a1b2c3d/)
  assert.equal(cli('approve', '--tag', TAG, '--conf-sha', head).status, 1)

  const unreleased = cli('check', '--tag', 'mlxvlm-macos-arm64-b2c3d4e', '--conf-sha', head)
  assert.equal(unreleased.status, 1)
  assert.match(unreleased.stderr, /Not Found/)

  assert.match(cli('check', '--tag', 'v0.7.12', '--conf-sha', checked).stderr, /--tag must look like/)
  assert.match(cli('check', '--tag', TAG, '--conf-sha', checked.slice(0, 7)).stderr, /--conf-sha must be a 40-character/)
  assert.equal(existsSync(join(repo, LIVE)), true)
  assert.equal(cli('promote', '--tag', TAG).status, 2)
})
