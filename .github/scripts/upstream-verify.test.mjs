import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { fakeGhPath } from '../fixtures/sdcpp/gh.mjs'
import {
  candidateId,
  checkedRun,
  dispatchedRun,
  gateRefusal,
  namesTag,
  resultsRefusal,
  statusOf,
  verifiedRun,
} from './upstream-verify.mjs'

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

// sd.cpp: core runs and their results.json from .github/fixtures/sdcpp.
const fixture = (path) => JSON.parse(readFileSync(new URL(`../fixtures/sdcpp/${path}`, import.meta.url), 'utf8'))
const SIGNED = 'master-883-137f740-a36f1b1a'
const sdRuns = fixture('runs.json')
const readResults = (r) => fixture(`results/${r.databaseId}.json`)

test('an sd.cpp tag is a word of the title: the fork build does not name the signed one', () => {
  const fork = sdRuns.find((r) => r.databaseId === 39500000101)
  const signed = sdRuns.find((r) => r.databaseId === 39500000103)
  assert.equal(namesTag(fork.displayTitle, 'master-883-137f740'), true)
  assert.equal(namesTag(fork.displayTitle, SIGNED), false)
  assert.equal(namesTag(signed.displayTitle, 'master-883-137f740'), false)
})

test('results.json must pass sd-cpp on the signed mirror of the very tag', () => {
  const pass = fixture('results/39500000103.json')
  assert.equal(resultsRefusal(pass, 'sd-cpp', SIGNED), null)
  const changed = (patch) => ({ ...pass, ...patch, candidate: { ...pass.candidate, ...patch.candidate } })
  assert.equal(resultsRefusal(changed({ status: 'incomplete' }), 'sd-cpp', SIGNED), 'status is incomplete')
  assert.equal(resultsRefusal(changed({ engine: 'llamacpp-upstream' }), 'sd-cpp', SIGNED), 'engine is llamacpp-upstream')
  assert.equal(
    resultsRefusal(changed({ candidate: { repo: 'AtomicBot-ai/stable-diffusion.cpp' } }), 'sd-cpp', SIGNED),
    'candidate.repo is AtomicBot-ai/stable-diffusion.cpp'
  )
  assert.equal(
    resultsRefusal(changed({ candidate: { tag: 'master-883-137f740' } }), 'sd-cpp', SIGNED),
    'candidate.tag is master-883-137f740'
  )
  assert.match(resultsRefusal({}, 'sd-cpp', SIGNED), /status is undefined, engine is undefined/)
})

test('the sd.cpp gate takes the newest successful run whose results back the tag', () => {
  const { run, refusal } = checkedRun(sdRuns, SIGNED, 'sd-cpp', readResults)
  assert.equal(refusal, undefined)
  assert.equal(run.databaseId, 39500000103)
})

test('the sd.cpp gate says why no run backs a tag', () => {
  const signed = 'master-890-1a2b3c4-a5d6e7f8'
  const { run, refusal } = checkedRun(sdRuns, signed, 'sd-cpp', readResults)
  assert.equal(run, undefined)
  assert.match(refusal, /39500000105: no results\.json/)
  assert.match(refusal, /39500000106: candidate\.repo is AtomicBot-ai\/stable-diffusion\.cpp, candidate\.tag is master-890-1a2b3c4/)
  assert.match(refusal, /engine=sd-cpp, repo=AtomicBot-ai\/atomic-chat-conf and tag=master-890-1a2b3c4-a5d6e7f8/)
  assert.match(
    checkedRun(sdRuns, 'master-891-0f0f0f0-a0e0e0e0', 'sd-cpp', readResults).refusal,
    /its last engine-candidate run is in_progress/
  )
  assert.match(
    checkedRun(sdRuns, 'master-900-0000000-a0000000', 'sd-cpp', readResults).refusal,
    /no engine-candidate run names it/
  )
  // Only a successful run is read: the failed one of the same tag is not.
  const failedOnly = sdRuns.filter((r) => r.databaseId === 39500000102)
  assert.match(checkedRun(failedOnly, SIGNED, 'sd-cpp', () => assert.fail('read')).refusal, /concluded failure/)
})

test('the gate CLI reads results.json for sd-cpp only', () => {
  const script = fileURLToPath(new URL('./upstream-verify.mjs', import.meta.url))
  const env = { ...process.env, PATH: fakeGhPath() }
  const cli = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env })

  const passed = cli('gate', '--engine', 'sd-cpp', '--tag', SIGNED)
  assert.equal(passed.status, 0, passed.stderr)
  assert.match(passed.stdout, /master-883-137f740-a36f1b1a verified: .*\n.*\/runs\/39500000103/)

  const refused = cli('gate', '--engine', 'sd-cpp', '--tag', 'master-890-1a2b3c4-a5d6e7f8')
  assert.equal(refused.status, 1)
  assert.match(refused.stderr, /no successful run backs it/)

  // llama.cpp keeps its title-only gate: run 39500000104 has no results to read.
  const llama = cli('gate', '--tag', 'b11734')
  assert.equal(llama.status, 0, llama.stderr)
  assert.match(llama.stdout, /b11734 verified/)

  const bare = cli('gate', '--engine', 'sd-cpp', '--tag', 'master-883-137f740')
  assert.equal(bare.status, 1)
  assert.match(bare.stderr, /--tag must look like master-883-137f740-a36f1b1a/)
  assert.match(cli('gate', '--engine', 'whisper', '--tag', SIGNED).stderr, /--engine must be one of llamacpp-upstream, sd-cpp/)
  assert.match(cli('gate', '--engine', 'toString', '--tag', SIGNED).stderr, /--engine must be one of/)
  assert.match(cli('verify', '--engine', 'sd-cpp', '--tag', SIGNED).stderr, /verify checks llama.cpp tags only/)
})
