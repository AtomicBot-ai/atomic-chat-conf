import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { candidateId, dispatchedRun, gateRefusal, namesTag, statusOf, verifiedRun } from './upstream-verify.mjs'

const title = (tag, cid, ref = 'main') => `engine-candidate llamacpp-upstream ${tag} [cid:${cid}] core@${ref}`
let nextId = 1
const run = (tag, cid, conclusion, createdAt, status = 'completed') => ({
  databaseId: nextId++,
  displayTitle: title(tag, cid),
  status,
  conclusion: status === 'completed' ? conclusion : '',
  createdAt,
  url: `https://github.com/AtomicBot-ai/atomic-chat-core/actions/runs/${nextId - 1}`,
})

test('a run names a tag as a word, and a candidate id', () => {
  assert.equal(candidateId('b11463'), 'conf-b11463')
  assert.equal(namesTag(title('b11463', 'conf-b11463'), 'b11463'), true)
  assert.equal(namesTag(title('b11463', 'phase0-smoke'), 'b11463'), true)
  assert.equal(namesTag(title('b11463', 'conf-b11463'), 'b1146'), false)
  assert.equal(namesTag(title('b114630', 'manual'), 'b11463'), false)
  assert.equal(namesTag('engine-candidate llamacpp-upstream b11463 core@main', 'b11463'), false)
  assert.equal(namesTag(title('newest', 'conf-b11463'), 'b11463'), false)
  assert.equal(namesTag(title('b11463', 'conf-b11463'), 'b11463', 'conf-b11463'), true)
  assert.equal(namesTag(title('b11463', 'phase0-smoke'), 'b11463', 'conf-b11463'), false)
  assert.equal(namesTag(undefined, 'b11463'), false)
})

test('the newest successful run of the tag verifies it, whatever checked it', () => {
  const runs = [
    run('b11463', 'conf-b11463', 'failure', '2026-10-15T12:00:00Z'),
    run('b11463', 'phase0-smoke', 'success', '2026-10-15T10:00:00Z'),
    run('b11463', 'conf-b11463', 'success', '2026-10-15T11:00:00Z'),
    run('b11500', 'conf-b11500', 'success', '2026-10-15T13:00:00Z'),
  ]
  assert.equal(verifiedRun(runs, 'b11463'), runs[2])
  assert.equal(gateRefusal(runs, 'b11463'), null)
  assert.equal(verifiedRun(runs, 'b11480'), undefined)
})

test('the gate says why a tag is not verified', () => {
  assert.match(gateRefusal([], 'b11463'), /b11463 is not verified: no engine-candidate run names it/)
  assert.match(gateRefusal([], 'b11463'), /make upstream-verify TAG=b11463.*FORCE=1/)
  const failed = run('b11463', 'conf-b11463', 'failure', '2026-10-15T12:00:00Z')
  const older = run('b11463', 'conf-b11463', 'cancelled', '2026-10-15T11:00:00Z')
  assert.match(gateRefusal([older, failed], 'b11463'), new RegExp(`concluded failure: ${failed.url}`))
  const running = run('b11463', 'conf-b11463', '', '2026-10-15T13:00:00Z', 'in_progress')
  assert.match(gateRefusal([failed, running], 'b11463'), /is in_progress/)
  const other = run('b11500', 'conf-b11500', 'success', '2026-10-15T13:00:00Z')
  assert.match(gateRefusal([other], 'b11463'), /no engine-candidate run names it/)
})

test('a dispatch finds its own run: the mirror candidate id, not listed before', () => {
  const earlier = run('b11463', 'conf-b11463', 'success', '2026-10-15T10:00:00Z')
  const smoke = run('b11463', 'phase0-smoke', '', '2026-10-15T12:00:01Z', 'queued')
  const ours = run('b11463', 'conf-b11463', '', '2026-10-15T12:00:00Z', 'queued')
  const before = new Set([earlier.databaseId])
  assert.equal(dispatchedRun([earlier], 'b11463', before), undefined)
  assert.equal(dispatchedRun([earlier, smoke, ours], 'b11463', before), ours)
})

test('reads the verdict of results.json', () => {
  for (const status of ['pass', 'fail', 'incomplete']) assert.equal(statusOf({ status }), status)
  assert.throws(() => statusOf({}), /status must be pass, fail, incomplete/)
  assert.throws(() => statusOf({ status: 'same-as-pin' }), /got "same-as-pin"/)
})

test('the gate CLI checks the tag, and FORCE=1 skips the lookup', () => {
  const script = fileURLToPath(new URL('./upstream-verify.mjs', import.meta.url))
  const cli = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
  const forced = cli('gate', '--tag', 'b11463', '--force')
  assert.equal(forced.status, 0)
  assert.match(forced.stderr, /FORCE=1: going ahead with b11463/)
  const malformed = cli('gate', '--tag', 'latest')
  assert.equal(malformed.status, 1)
  assert.match(malformed.stderr, /--tag must look like b11463/)
  assert.equal(cli('approve', '--tag', 'b11463').status, 2)
})
