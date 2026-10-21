#!/usr/bin/env node
// The check between mirroring a llama.cpp tag and approving it. Core's
// engine-candidate workflow (AtomicBot-ai/atomic-chat-core,
// .github/workflows/engine-candidate.yml) runs core's suites and its live
// llama.cpp tests on five OSes against a build, the current pin beside it. It
// runs only when someone starts it.
//
//   verify --tag b11463
//       check the signed bytes this repository mirrors for a tag: dispatch the
//       workflow with repo=AtomicBot-ai/atomic-chat-conf and
//       candidate_id=conf-<tag>, watch the run and print its results.json
//       status; exit 0 only on pass (`make upstream-verify`)
//   gate --tag b11463 [--force]
//       fail unless a successful engine-candidate run names the tag
//       (`make upstream-approve` and `make upstream-promote` run it first;
//       the mirror workflow's own promote does not)
//   gate --engine sd-cpp --tag master-883-137f740-a36f1b1a [--force]
//       the same for a signed sd.cpp build (sdcpp-approve.yml), and that run's
//       results.json must say it checked sd-cpp on this repository's release of
//       the tag and passed
//
// Runs are found by title, `engine-candidate <engine> <tag> [cid:<id>] core@<ref>`.
// The workflow fails unless results.json says pass, so a successful run is a
// passing one.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TAG_RE as SDCPP_TAG_RE } from './sdcpp-approve.mjs'
import { MIRROR_REPO, TAG_RE } from './upstream-releases.mjs'

export const CORE_REPO = 'AtomicBot-ai/atomic-chat-core'
export const CANDIDATE_WORKFLOW = 'engine-candidate.yml'
export const RESULTS_ARTIFACT = 'engine-candidate-results'
const RUN_FIELDS = 'databaseId,displayTitle,status,conclusion,createdAt,url'
const STATUSES = ['pass', 'fail', 'incomplete']

// What `gate` asks for, per engine. For llama.cpp a successful run that names
// the tag is enough. The sd.cpp approval writes the live manifest itself, so
// its gate also reads the run's results.json: a run on the fork's build, or
// on another engine, must not count.
export const GATES = {
  'llamacpp-upstream': { tagRe: TAG_RE, example: 'b11463', readsResults: false },
  'sd-cpp': { tagRe: SDCPP_TAG_RE, example: 'master-883-137f740-a36f1b1a', readsResults: true },
}

/** The candidate_id of a check of this repository's mirror of a tag. */
export function candidateId(tag) {
  return `conf-${tag}`
}

/**
 * True when a run title names the tag as a word (b1146 is not b11463) and a
 * candidate id: `cid` itself when given, any otherwise.
 */
export function namesTag(title, tag, cid) {
  const words = (title ?? '').split(/\s+/)
  return words.includes(tag) && words.some((w) => (cid ? w === `[cid:${cid}]` : w.startsWith('[cid:')))
}

const newestFirst = (runs) => [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

/** The newest successful run that names the tag. `runs` as `gh run list --json` gives them. */
export function verifiedRun(runs, tag) {
  return newestFirst(runs).find((r) => r.conclusion === 'success' && namesTag(r.displayTitle, tag))
}

/** What the newest run that names the tag did, for a refusal. */
function lastRunOf(runs, tag) {
  const last = newestFirst(runs).find((r) => namesTag(r.displayTitle, tag))
  return !last
    ? 'no engine-candidate run names it'
    : last.status === 'completed'
      ? `its last engine-candidate run concluded ${last.conclusion}: ${last.url}`
      : `its last engine-candidate run is ${last.status}: ${last.url}`
}

/** Why the tag may not be approved yet, or null when a successful run backs it. */
export function gateRefusal(runs, tag) {
  if (verifiedRun(runs, tag)) return null
  return `${tag} is not verified: ${lastRunOf(runs, tag)}. Run \`make upstream-verify TAG=${tag}\`, or add FORCE=1 to go ahead anyway.`
}

/** Why a run's results.json does not back the engine's tag on the signed mirror, or null when it does. */
export function resultsRefusal(results, engine, tag) {
  const problems = []
  if (results?.status !== 'pass') problems.push(`status is ${results?.status}`)
  if (results?.engine !== engine) problems.push(`engine is ${results?.engine}`)
  if (results?.candidate?.repo !== MIRROR_REPO) problems.push(`candidate.repo is ${results?.candidate?.repo}`)
  if (results?.candidate?.tag !== tag) problems.push(`candidate.tag is ${results?.candidate?.tag}`)
  return problems.length === 0 ? null : problems.join(', ')
}

/**
 * The newest successful run that names the tag and whose results.json backs it
 * (`{ run }`), or why there is none (`{ refusal }`). `readResults(run)` returns
 * that run's results.json and throws when it has none.
 */
export function checkedRun(runs, tag, engine, readResults) {
  const rejected = []
  for (const run of newestFirst(runs)) {
    if (run.conclusion !== 'success' || !namesTag(run.displayTitle, tag)) continue
    let why
    try {
      why = resultsRefusal(readResults(run), engine, tag)
    } catch (err) {
      why = `no results.json (${err instanceof Error ? err.message : String(err)})`
    }
    if (!why) return { run }
    rejected.push(`${run.url}: ${why}`)
  }
  const seen = rejected.length > 0 ? `no successful run backs it: ${rejected.join('; ')}` : lastRunOf(runs, tag)
  return {
    refusal:
      `${tag} is not verified: ${seen}. Run core's engine-candidate with engine=${engine}, ` +
      `repo=${MIRROR_REPO} and tag=${tag}.`,
  }
}

/** The run a dispatch for the tag started: it names the tag and conf-<tag>, and was not listed before. */
export function dispatchedRun(runs, tag, before) {
  return newestFirst(runs).find(
    (r) => !before.has(r.databaseId) && namesTag(r.displayTitle, tag, candidateId(tag))
  )
}

/** The verdict of a results.json: pass, fail or incomplete. */
export function statusOf(results) {
  if (!STATUSES.includes(results?.status)) {
    throw new Error(`results.json status must be ${STATUSES.join(', ')} (got "${results?.status}")`)
  }
  return results.status
}

function gh(args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    throw new Error(`gh ${args.slice(0, 2).join(' ')}: ${String(err.stderr ?? err.message).trim()}`)
  }
}

/** Recent engine-candidate runs in core, as `gh run list --json` gives them. */
export function listRuns() {
  const args = ['run', 'list', '--repo', CORE_REPO, '--workflow', CANDIDATE_WORKFLOW, '--limit', '200']
  return JSON.parse(gh([...args, '--json', RUN_FIELDS]))
}

/** The results.json (and results.md, when there is one) a core run uploaded. */
export function downloadResults(runId) {
  const dir = mkdtempSync(join(tmpdir(), 'upstream-verify-'))
  try {
    gh(['run', 'download', String(runId), '--repo', CORE_REPO, '--name', RESULTS_ARTIFACT, '--dir', dir])
    const results = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'))
    const md = existsSync(join(dir, 'results.md')) ? readFileSync(join(dir, 'results.md'), 'utf8') : null
    return { results, md }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function verify(tag) {
  try {
    gh(['release', 'view', tag, '--repo', MIRROR_REPO, '--json', 'tagName'])
  } catch {
    throw new Error(`${MIRROR_REPO} has no release ${tag}: run \`make mirror TAG=${tag}\` first`)
  }
  const before = new Set(listRuns().map((r) => r.databaseId))
  gh([
    'workflow', 'run', CANDIDATE_WORKFLOW, '--repo', CORE_REPO,
    '-f', `tag=${tag}`, '-f', `repo=${MIRROR_REPO}`, '-f', `candidate_id=${candidateId(tag)}`,
  ])
  let run
  for (let i = 0; i < 24 && !run; i++) {
    await sleep(5000)
    run = dispatchedRun(listRuns(), tag, before)
  }
  if (!run) throw new Error(`Dispatched ${CANDIDATE_WORKFLOW}, but no run for [cid:${candidateId(tag)}] showed up in two minutes`)
  process.stdout.write(`Watching ${run.url}\n`)
  spawnSync('gh', ['run', 'watch', String(run.databaseId), '--repo', CORE_REPO, '--interval', '30'], {
    stdio: 'inherit',
  })

  const { results, md } = downloadResults(run.databaseId)
  if (md !== null) process.stdout.write(`\n${md}\n`)
  const status = statusOf(results)
  process.stdout.write(`engine-candidate ${tag} (signed mirror): ${status}\n${run.url}\n`)
  return status === 'pass' ? 0 : 1
}

function gate(tag, force, engine) {
  if (force) {
    process.stderr.write(`FORCE=1: going ahead with ${tag} without checking for an engine-candidate run\n`)
    return 0
  }
  const runs = listRuns()
  const { run, refusal } = GATES[engine].readsResults
    ? checkedRun(runs, tag, engine, (r) => downloadResults(r.databaseId).results)
    : { run: verifiedRun(runs, tag), refusal: gateRefusal(runs, tag) }
  if (refusal) {
    process.stderr.write(`${refusal}\n`)
    return 1
  }
  process.stdout.write(`${tag} verified: ${run.displayTitle}\n${run.url}\n`)
  return 0
}

const argValue = (argv, name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

async function main(argv) {
  const command = argv[0]
  const tag = argValue(argv, '--tag')
  const engine = argValue(argv, '--engine') ?? 'llamacpp-upstream'
  if (command !== 'verify' && command !== 'gate') {
    process.stderr.write('Usage: upstream-verify.mjs verify|gate [--engine sd-cpp] --tag b11463 [--force] (see the header)\n')
    return 2
  }
  const spec = Object.hasOwn(GATES, engine) ? GATES[engine] : undefined
  if (!spec) throw new Error(`--engine must be one of ${Object.keys(GATES).join(', ')} (got "${engine}")`)
  if (command === 'verify' && engine !== 'llamacpp-upstream') throw new Error('verify checks llama.cpp tags only')
  if (!spec.tagRe.test(tag ?? '')) throw new Error(`--tag must look like ${spec.example} (got "${tag}")`)
  return command === 'verify' ? verify(tag) : gate(tag, argv.includes('--force'), engine)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    }
  )
}
