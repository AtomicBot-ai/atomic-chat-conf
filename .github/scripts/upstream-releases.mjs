#!/usr/bin/env node
// Maintains backends/llamacpp-upstream-releases.json, the release list of the
// llamacpp-upstream provider: ggml-org/llama.cpp builds this repository
// mirrors and signs. Cores from 0.15.0 read it and take, per backend, the
// newest approved release whose min_core_version they meet. Older cores read
// only backends/manifest.json, so that file names a release every core runs.
//
//   add --tag b11463 --dir dist [--min-core-version 0.16.0]
//       list a freshly mirrored tag, every asset `candidate` (mirror workflow)
//   guard --tag b11463
//       fail when the tag has approved assets: a re-run re-signs the archives
//       and would replace bits clients already hold a hash for
//   approve --tag b11463 [--min-core-version 0.16.0] [--only name,name]
//       mark verified assets `approved`
//   promote --tag b11463
//       a release every core runs: approve every asset at min_core_version
//       0.0.0 and point backends/manifest.json at it
//   withdraw --tag b11463 --reason "..."
//   backfill --tag b11463
//       list a tag mirrored before this file existed, from its release digests
//   prune
//       drop releases a newer one fully replaces
//   keep-tags
//       the mirrored releases the workflow's prune must keep, one per line
//   check
//       integrity rules the schema cannot express (CI and `make validate`)

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { MIRROR_DOWNLOAD_BASE, legacyManifest, sha256File } from './mirror.mjs'

export const UPSTREAM_REPO = 'ggml-org/llama.cpp'
export const MIRROR_REPO = 'AtomicBot-ai/atomic-chat-conf'
/** The min_core_version of a release every core that reads this list runs. */
export const ANY_CORE = '0.0.0'
export const TAG_RE = /^b(\d+)$/
const VERSION_RE = /^\d+\.\d+\.\d+$/
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

export function buildOf(tag) {
  const m = TAG_RE.exec(tag ?? '')
  return m ? Number(m[1]) : undefined
}

export function compareVersions(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return 0
}

export function timestamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** The empty list a first `add` or `backfill` starts from. */
export function emptyList(updatedAt) {
  return {
    $schema: './llamacpp-upstream-releases-schema.json',
    schema_version: 1,
    updated_at: updatedAt,
    upstream_repo: UPSTREAM_REPO,
    download_base: MIRROR_DOWNLOAD_BASE,
    releases: [],
  }
}

/** Fixed key order, so a rewrite only shows what changed. */
function normalize({ tag, commit, published_at, min_core_version, notes_url, notes, withdrawn, assets }) {
  return {
    tag,
    commit,
    published_at,
    min_core_version,
    notes_url,
    ...(notes ? { notes } : {}),
    ...(withdrawn ? { withdrawn } : {}),
    assets,
  }
}

function withReleases(list, releases, updatedAt) {
  const sorted = releases.map(normalize).sort((a, b) => buildOf(b.tag) - buildOf(a.tag))
  return { ...list, updated_at: updatedAt, releases: sorted }
}

function findRelease(list, tag) {
  const release = list.releases.find((r) => r.tag === tag)
  if (!release) throw new Error(`${tag} is not listed in backends/llamacpp-upstream-releases.json`)
  return release
}

function sha256FromDigest(digest) {
  const m = /^sha256:([0-9a-f]{64})$/.exec(digest ?? '')
  return m ? m[1] : undefined
}

/**
 * A release entry from the upstream GitHub release object and the mirrored
 * archives. Every asset is `candidate`. `min_core_version` is left out unless
 * given, so a re-run keeps the one the release already has.
 */
export function releaseEntry(upstream, archives, options = {}) {
  const tag = upstream.tag_name
  if (!TAG_RE.test(tag ?? '')) throw new Error(`Not a ggml-org release tag: ${tag}`)
  const commit = upstream.target_commitish
  if (!/^[0-9a-f]{40}$/.test(commit ?? '')) {
    throw new Error(`Release ${tag} has no full commit sha (target_commitish=${commit})`)
  }
  if (options.minCoreVersion !== undefined && !VERSION_RE.test(options.minCoreVersion)) {
    throw new Error(`--min-core-version must look like 0.16.0 (got "${options.minCoreVersion}")`)
  }
  const prefix = `llama-${tag}-bin-`
  const assets = archives
    .filter((a) => a.name.startsWith(prefix))
    .map(({ name, sha256, size }) => ({ name, sha256, size, validation: 'candidate' }))
    .sort((a, b) => a.name.localeCompare(b.name))
  if (assets.length === 0) throw new Error(`No ${prefix}* archives for ${tag}`)
  return {
    tag,
    commit,
    published_at: upstream.published_at,
    ...(options.minCoreVersion !== undefined ? { min_core_version: options.minCoreVersion } : {}),
    notes_url: `https://github.com/${UPSTREAM_REPO}/releases/tag/${tag}`,
    assets,
  }
}

/** The mirrored archives of a tag in a directory, hashed. */
export async function hashArchives(dir, tag) {
  const names = (await readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.startsWith(`llama-${tag}-bin-`))
    .map((e) => e.name)
    .sort()
  const archives = []
  for (const name of names) {
    const path = join(dir, name)
    archives.push({ name, sha256: await sha256File(path), size: (await stat(path)).size })
  }
  return archives
}

/** The archives of a mirrored release, from the digests GitHub publishes for its assets. */
export function archivesFromRelease(release) {
  return (release.assets ?? []).map((asset) => {
    const sha256 = sha256FromDigest(asset.digest)
    if (!sha256) throw new Error(`Asset ${asset.name} has no sha256 digest`)
    return { name: asset.name, sha256, size: asset.size }
  })
}

/** Why the mirror must not re-run a tag, or null when it may. */
export function rerunRefusal(list, tag) {
  const release = list.releases.find((r) => r.tag === tag)
  const approved = (release?.assets ?? []).filter((a) => a.validation === 'approved')
  if (approved.length === 0) return null
  return (
    `${tag} has ${approved.length} approved asset(s). ` +
    'A re-run re-signs every archive and would replace bits clients already verified; mirror a newer tag instead.'
  )
}

/**
 * The list with a mirrored tag as a candidate. A re-run of a listed tag
 * replaces its archives: they were re-signed, so nothing verified carries
 * over. Its min_core_version, notes and withdrawal stay.
 */
export function upsertCandidate(list, entry, updatedAt) {
  const existing = list.releases.find((r) => r.tag === entry.tag)
  if (!existing) {
    const release = { min_core_version: ANY_CORE, ...entry }
    return withReleases(list, [...list.releases, release], updatedAt)
  }
  const refusal = rerunRefusal(list, entry.tag)
  if (refusal) throw new Error(refusal)
  const replaced = {
    ...existing,
    ...entry,
    min_core_version: entry.min_core_version ?? existing.min_core_version,
  }
  return withReleases(
    list,
    list.releases.map((r) => (r.tag === entry.tag ? replaced : r)),
    updatedAt
  )
}

/** The list with the named assets of a release (all when `only` is empty) approved. */
export function approve(list, tag, options, updatedAt) {
  const release = findRelease(list, tag)
  if (release.withdrawn) throw new Error(`${tag} is withdrawn: ${release.withdrawn.reason}`)
  const names = new Set(options.only ?? [])
  for (const name of names) {
    if (!release.assets.some((a) => a.name === name)) throw new Error(`${tag} has no asset ${name}`)
  }
  if (options.minCoreVersion !== undefined && !VERSION_RE.test(options.minCoreVersion)) {
    throw new Error(`--min-core-version must look like 0.16.0 (got "${options.minCoreVersion}")`)
  }
  const approved = {
    ...release,
    min_core_version: options.minCoreVersion ?? release.min_core_version,
    assets: release.assets.map((a) =>
      names.size === 0 || names.has(a.name) ? { ...a, validation: 'approved' } : a
    ),
  }
  return withReleases(
    list,
    list.releases.map((r) => (r.tag === tag ? approved : r)),
    updatedAt
  )
}

/**
 * A release every core runs: every asset approved at min_core_version 0.0.0,
 * and the legacy manifest older cores follow pointed at exactly those bytes.
 */
export function promote(list, tag, updatedAt) {
  const next = approve(list, tag, { minCoreVersion: ANY_CORE }, updatedAt)
  const release = findRelease(next, tag)
  const archives = release.assets.map(({ name, sha256, size }) => ({ name, sha256, size }))
  return { list: next, manifest: legacyManifest(tag, archives, next.download_base, updatedAt) }
}

/** The list with a release pulled from offers. The release older cores follow cannot be. */
export function withdraw(list, tag, reason, legacyTag, updatedAt) {
  if (!reason) throw new Error('A withdrawal needs a --reason')
  if (tag === legacyTag) {
    throw new Error(`backends/manifest.json names ${tag}; promote another release before withdrawing it`)
  }
  const release = findRelease(list, tag)
  return withReleases(
    list,
    list.releases.map((r) => (r.tag === tag ? { ...release, withdrawn: { reason } } : r)),
    updatedAt
  )
}

function backendPart(tag, name) {
  return name.slice(`llama-${tag}-bin-`.length)
}

function approvedBackends(release) {
  return new Set(
    release.assets.filter((a) => a.validation === 'approved').map((a) => backendPart(release.tag, a.name))
  )
}

/**
 * True when every core that would take `older` takes `newer` instead: newer
 * is not withdrawn, needs no newer core, and is approved for every backend
 * older is approved for. A candidate-only release is replaced by any newer
 * one, so a fresh mirror retires the previous candidate.
 */
export function replaces(newer, older) {
  if (newer.withdrawn) return false
  if (compareVersions(newer.min_core_version, older.min_core_version) > 0) return false
  const offered = approvedBackends(newer)
  return [...approvedBackends(older)].every((backend) => offered.has(backend))
}

/** The list without the releases a newer one replaces. Tags in `keep` stay. */
export function pruneList(list, keep, updatedAt) {
  const releases = [...list.releases].sort((a, b) => buildOf(b.tag) - buildOf(a.tag))
  const kept = []
  const dropped = []
  releases.forEach((release, i) => {
    const by = keep.has(release.tag) ? undefined : releases.slice(0, i).find((n) => replaces(n, release))
    if (by) dropped.push({ tag: release.tag, by: by.tag })
    else kept.push(release)
  })
  if (dropped.length === 0) return { list, dropped }
  return { list: withReleases(list, kept, updatedAt), dropped }
}

/** The mirrored releases still in use: every listed, non-withdrawn tag and the legacy manifest's. */
export function keepTags(list, legacy) {
  const tags = new Set([legacy.tag_name])
  for (const release of list.releases) if (!release.withdrawn) tags.add(release.tag)
  return [...tags]
}

/** Integrity rules the JSON Schema cannot express. Returns a list of errors. */
export function checkReleases(list, legacy) {
  const errors = []
  if (list.upstream_repo !== UPSTREAM_REPO) errors.push(`upstream_repo must be ${UPSTREAM_REPO}`)
  if (!ISO_RE.test(list.updated_at ?? '')) errors.push('updated_at must be an ISO-8601 UTC timestamp')
  if (legacy.download_base && list.download_base !== legacy.download_base) {
    errors.push(`download_base must match backends/manifest.json (${legacy.download_base})`)
  }
  const tags = new Set()
  let previousBuild = Infinity
  for (const release of list.releases ?? []) {
    const build = buildOf(release.tag)
    if (build === undefined) {
      errors.push(`Malformed tag: ${release.tag}`)
      continue
    }
    if (tags.has(release.tag)) errors.push(`Duplicate release: ${release.tag}`)
    tags.add(release.tag)
    if (build >= previousBuild) errors.push(`Releases must be listed newest first (${release.tag})`)
    previousBuild = build
    if (!ISO_RE.test(release.published_at ?? '')) {
      errors.push(`Release ${release.tag}: published_at must be an ISO-8601 UTC timestamp`)
    }
    const names = new Set()
    for (const asset of release.assets ?? []) {
      if (names.has(asset.name)) errors.push(`Release ${release.tag}: duplicate asset ${asset.name}`)
      names.add(asset.name)
      if (!asset.name.startsWith(`llama-${release.tag}-bin-`)) {
        errors.push(`Release ${release.tag}: asset ${asset.name} belongs to another tag`)
      }
    }
  }
  // Cores before 0.15.0 follow the legacy manifest alone: it has to name a
  // release every core runs, with the very bytes listed here.
  const current = (list.releases ?? []).find((r) => r.tag === legacy.tag_name)
  if (!current) {
    errors.push(`backends/manifest.json names ${legacy.tag_name}, which is not listed`)
    return errors
  }
  if (current.withdrawn) errors.push(`backends/manifest.json names ${current.tag}, which is withdrawn`)
  if (current.min_core_version !== ANY_CORE) {
    errors.push(
      `backends/manifest.json names ${current.tag}, which needs core ${current.min_core_version}; ` +
        `it may only name a release with min_core_version ${ANY_CORE}`
    )
  }
  for (const asset of (legacy.assets ?? []).filter((a) => a.sha256)) {
    const listed = current.assets.find((a) => a.name === asset.name)
    if (!listed) errors.push(`${asset.name} is in backends/manifest.json but not listed`)
    else if (listed.sha256 !== asset.sha256 || listed.size !== asset.size) {
      errors.push(`${asset.name}: sha256 or size differ from backends/manifest.json`)
    } else if (listed.validation !== 'approved') {
      errors.push(`${asset.name} is in backends/manifest.json but not approved`)
    }
  }
  return errors
}

async function fetchRelease(repo, tag) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'atomic-chat-conf' }
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, { headers })
  if (!res.ok) throw new Error(`GitHub API ${repo} ${tag}: HTTP ${res.status}`)
  return res.json()
}

function argValue(argv, name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

function requireTag(argv) {
  const tag = argValue(argv, '--tag')
  if (!TAG_RE.test(tag ?? '')) throw new Error(`--tag must look like b11463 (got "${tag}")`)
  return tag
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
}

async function main(argv) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const listPath = join(root, 'backends', 'llamacpp-upstream-releases.json')
  const legacyPath = join(root, 'backends', 'manifest.json')
  const readList = () => (existsSync(listPath) ? JSON.parse(readFileSync(listPath, 'utf8')) : emptyList(timestamp()))
  const readLegacy = () => JSON.parse(readFileSync(legacyPath, 'utf8'))
  const command = argv[0]
  const now = timestamp()

  if (command === 'add') {
    const tag = requireTag(argv)
    const dir = argValue(argv, '--dir')
    if (!dir) throw new Error('--dir is required')
    const minCoreVersion = argValue(argv, '--min-core-version') || undefined
    const entry = releaseEntry(await fetchRelease(UPSTREAM_REPO, tag), await hashArchives(dir, tag), {
      minCoreVersion,
    })
    writeJson(listPath, upsertCandidate(readList(), entry, now))
    process.stdout.write(`listed ${tag} as candidate (${entry.assets.length} assets)\n`)
    return 0
  }
  if (command === 'guard') {
    const refusal = rerunRefusal(readList(), requireTag(argv))
    if (refusal) process.stderr.write(`::error::${refusal}\n`)
    return refusal ? 1 : 0
  }
  if (command === 'approve') {
    const tag = requireTag(argv)
    const only = argValue(argv, '--only')
    const list = approve(
      readList(),
      tag,
      {
        minCoreVersion: argValue(argv, '--min-core-version') || undefined,
        only: only ? only.split(',').filter(Boolean) : [],
      },
      now
    )
    writeJson(listPath, list)
    const release = findRelease(list, tag)
    process.stdout.write(`approved ${tag} for core >= ${release.min_core_version}\n`)
    return 0
  }
  if (command === 'promote') {
    const tag = requireTag(argv)
    const { list, manifest } = promote(readList(), tag, now)
    writeJson(listPath, list)
    writeJson(legacyPath, manifest)
    process.stdout.write(`promoted ${tag}: every core, backends/manifest.json moved\n`)
    return 0
  }
  if (command === 'withdraw') {
    const tag = requireTag(argv)
    writeJson(listPath, withdraw(readList(), tag, argValue(argv, '--reason'), readLegacy().tag_name, now))
    process.stdout.write(`withdrew ${tag}\n`)
    return 0
  }
  if (command === 'backfill') {
    const tag = requireTag(argv)
    const [upstream, mirrored] = await Promise.all([fetchRelease(UPSTREAM_REPO, tag), fetchRelease(MIRROR_REPO, tag)])
    const entry = releaseEntry(upstream, archivesFromRelease(mirrored), {
      minCoreVersion: argValue(argv, '--min-core-version') || undefined,
    })
    writeJson(listPath, upsertCandidate(readList(), entry, now))
    process.stdout.write(`listed ${tag} as candidate (${entry.assets.length} assets)\n`)
    return 0
  }
  if (command === 'prune') {
    const { list, dropped } = pruneList(readList(), new Set([readLegacy().tag_name]), now)
    if (dropped.length > 0) writeJson(listPath, list)
    for (const { tag, by } of dropped) process.stdout.write(`dropped ${tag}: replaced by ${by}\n`)
    if (dropped.length === 0) process.stdout.write('nothing to drop\n')
    return 0
  }
  if (command === 'keep-tags') {
    for (const tag of keepTags(readList(), readLegacy())) process.stdout.write(`${tag}\n`)
    return 0
  }
  if (command === 'check') {
    const errors = checkReleases(readList(), readLegacy())
    for (const error of errors) process.stderr.write(`::error::${error}\n`)
    if (errors.length === 0) process.stdout.write('Upstream release list OK\n')
    return errors.length === 0 ? 0 : 1
  }
  process.stderr.write(
    'Usage: upstream-releases.mjs add|guard|approve|promote|withdraw|backfill|prune|keep-tags|check (see the header)\n'
  )
  return 2
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
