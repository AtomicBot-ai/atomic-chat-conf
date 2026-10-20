#!/usr/bin/env node
// Maintains backends/atomic-prism-manifest.json, the release catalog of the
// atomic-prism provider (PrismML-Eng/llama.cpp builds).
//
//   node .github/scripts/prism-manifest.mjs latest
//       prints the newest PrismML release tag
//   node .github/scripts/prism-manifest.mjs add --tag prism-b10754-2459f68 [--min-core-version x.y.z]
//       appends that release as `candidate` with PrismML's own digests (no-op
//       when it is already listed). Refused once the manifest points at the
//       signed mirror: a tag listed without mirroring would 404
//   node .github/scripts/prism-manifest.mjs mirrored --tag prism-b10787-73bfe6c --dir dist [--min-core-version x.y.z]
//       lists the archives mirror-prism.yml put in dist, with their own sha256
//       and size: a new tag as `candidate`, a listed one with its hashes
//       replaced (refused for an approved archive whose bytes would change)
//   node .github/scripts/prism-manifest.mjs use-mirror --mirrored <file of tags>
//       points download_base at this repository's releases once every listed
//       tag is mirrored here
//   node .github/scripts/prism-manifest.mjs gate --tag prism-b10754-2459f68 [--force]
//       fail unless a successful engine-candidate run in core names the tag
//   node .github/scripts/prism-manifest.mjs approve --tag prism-b10754-2459f68 [--min-core-version x.y.z]
//       every asset of a listed release, companions included, becomes `approved`
//   node .github/scripts/prism-manifest.mjs withdraw --tag prism-b10754-2459f68 --reason "..."
//       marks a release withdrawn: cores stop offering it and move off it
//   node .github/scripts/prism-manifest.mjs check
//       integrity checks for both Prism manifests (CI and `make validate`)
//
// Approval follows a passing engine-candidate run (engine=atomic-prism) in
// core: `gate` refuses a tag no such run names. The engine update pipeline
// (AtomicBot-ai/atomic-hatchet-pipeline) mirrors and signs a build with
// mirror-prism.yml, checks it and approves it with prism-approve.yml. GPU packs
// are approved with the CPU ones: CI runs CPU only.
//
// download_base is one for the whole manifest, so it moves to the mirror only
// once every listed tag is there; builds listed before signing began are
// mirrored byte-for-byte (sign=false), keeping the hashes clients hold.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { listRuns, namesTag, verifiedRun } from './upstream-verify.mjs'

export const UPSTREAM_REPO = 'PrismML-Eng/llama.cpp'
export const MIRROR_DOWNLOAD_BASE = 'https://github.com/AtomicBot-ai/atomic-chat-conf/releases/download'
export const DEFAULT_MIN_CORE_VERSION = '0.10.0'
export const TAG_RE = /^prism-b(\d+)-[0-9a-f]{7}$/
const VERSION_RE = /^\d+\.\d+\.\d+$/
export const CAPABILITIES = ['q1_0', 'q2_0_g64', 'pq2_0', 'ptq1_0', 'hadamard', 'vision']

// Driver floors follow atomic-chat-core's CUDA_DRIVER_FLOORS (src/backend/select/features.ts),
// so a Prism CUDA pack is gated exactly like the other providers' CUDA builds.
const DRIVER_FLOORS = {
  linux: { 12: '525.60.13', 13: '580' },
  win: { 12: '551.61', 13: '581.15' },
}
const CUDA13_MIN_COMPUTE_CAPABILITY = '7.5'

const SIMPLE_SUFFIXES = new Map([
  ['macos-arm64', 'macos-arm64'],
  ['macos-x64', 'macos-x64'],
  ['ubuntu-x64', 'linux-cpu-x64'],
  ['ubuntu-vulkan-x64', 'linux-vulkan-x64'],
  ['win-cpu-x64', 'win-cpu-x64'],
  ['win-vulkan-x64', 'win-vulkan-x64'],
  ['win-hip-radeon-x64', 'win-hip-radeon-x64'],
])

/**
 * The stable backend id for a release asset, or null for assets the desktop
 * app does not ship (arm64 builds, Android, the iOS XCFramework, KleidiAI).
 */
export function backendForAsset(name, tag) {
  const cudart = /^cudart-llama-bin-win-cuda-(\d+\.\d+)-x64\.zip$/.exec(name)
  if (cudart) return { backend: `win-cudart-${cudart[1]}-x64`, companion: true }
  const prefix = `llama-${tag}-bin-`
  if (!name.startsWith(prefix)) return null
  const rest = name.slice(prefix.length)
  const m = /^(.+)\.(zip|tar\.gz)$/.exec(rest)
  if (!m) return null
  const [, suffix, ext] = m
  const windows = suffix.startsWith('win-')
  if ((ext === 'zip') !== windows) return null
  const simple = SIMPLE_SUFFIXES.get(suffix)
  if (simple) return { backend: simple }
  const cuda = /^(linux|win)-cuda-(\d+\.\d+)-x64$/.exec(suffix)
  if (cuda) return { backend: `${cuda[1]}-cuda-${cuda[2]}-x64` }
  const rocm = /^ubuntu-rocm-(\d+\.\d+)-x64$/.exec(suffix)
  if (rocm) return { backend: `linux-rocm-${rocm[1]}-x64` }
  return null
}

/** Driver, architecture and companion requirements of a CUDA pack; {} for anything else. */
export function cudaRequirements(backend) {
  const m = /^(linux|win)-cuda-(\d+)\.(\d+)-x64$/.exec(backend)
  if (!m) return {}
  const [, os, major, minor] = m
  const floor = DRIVER_FLOORS[os][major]
  const out = {}
  if (floor) out.min_driver = floor
  if (Number(major) >= 13) out.min_compute_capability = CUDA13_MIN_COMPUTE_CAPABILITY
  if (os === 'win') out.companion_backend = `win-cudart-${major}.${minor}-x64`
  return out
}

function sha256FromDigest(digest) {
  const m = /^sha256:([0-9a-f]{64})$/.exec(digest ?? '')
  return m ? m[1] : undefined
}

/**
 * A manifest release entry from a GitHub release API object. Every asset is
 * `candidate`; assets without a published sha256 digest are refused rather
 * than listed unverified.
 */
export function releaseEntry(release, options = {}) {
  // options.hashes: { name: { sha256, size } } of mirrored files, in place of
  // PrismML's digests; every selected asset must be among them
  const tag = release.tag_name
  if (!TAG_RE.test(tag ?? '')) throw new Error(`Not a PrismML release tag: ${tag}`)
  const commit = release.target_commitish
  if (!/^[0-9a-f]{40}$/.test(commit ?? '')) {
    throw new Error(`Release ${tag} has no full commit sha (target_commitish=${commit})`)
  }
  const assets = []
  for (const asset of release.assets ?? []) {
    const id = backendForAsset(asset.name, tag)
    if (!id) continue
    const mirrored = options.hashes?.[asset.name]
    if (options.hashes && !mirrored) throw new Error(`Asset ${asset.name} was not mirrored`)
    const sha256 = mirrored?.sha256 ?? sha256FromDigest(asset.digest)
    if (!sha256) throw new Error(`Asset ${asset.name} has no sha256 digest`)
    assets.push({
      backend: id.backend,
      name: asset.name,
      size: mirrored?.size ?? asset.size,
      sha256,
      validation: 'candidate',
      ...(id.companion ? { companion: true } : {}),
      ...cudaRequirements(id.backend),
    })
  }
  assets.sort((a, b) => a.backend.localeCompare(b.backend))
  if (assets.length === 0) throw new Error(`Release ${tag} has no desktop assets`)
  return {
    tag,
    commit,
    published_at: release.published_at,
    min_core_version: options.minCoreVersion ?? DEFAULT_MIN_CORE_VERSION,
    notes_url: `https://github.com/${UPSTREAM_REPO}/releases/tag/${tag}`,
    capabilities: options.capabilities ?? ['q1_0', 'q2_0_g64', 'pq2_0', 'ptq1_0', 'hadamard', 'vision'],
    assets,
  }
}

export function buildOf(tag) {
  const m = TAG_RE.exec(tag ?? '')
  return m ? Number(m[1]) : undefined
}

/** The manifest with `entry` added, newest first. Unchanged when the tag is already listed. */
export function addRelease(manifest, entry, now) {
  if (manifest.releases.some((r) => r.tag === entry.tag)) return { manifest, added: false }
  const releases = [...manifest.releases, entry].sort((a, b) => buildOf(b.tag) - buildOf(a.tag))
  return { manifest: { ...manifest, updated_at: now, releases }, added: true }
}

/** sha256 and size of every file in `dir`, by name: what mirror-prism.yml publishes. */
export function hashFiles(dir) {
  const out = {}
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name)
    if (!statSync(path).isFile()) continue
    const bytes = readFileSync(path)
    out[name] = { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }
  }
  return out
}

/**
 * The manifest with a mirrored entry in it: a new tag listed as `candidate`; a
 * listed one gets the mirrored hashes and sizes, each asset keeping its
 * validation. An approved archive whose bytes change is refused: clients
 * already hold its hash.
 */
export function upsertMirrored(manifest, entry, options, now) {
  const listed = manifest.releases.find((r) => r.tag === entry.tag)
  if (!listed) {
    const fresh = { ...entry, min_core_version: options.minCoreVersion ?? entry.min_core_version }
    return { manifest: addRelease(manifest, fresh, now).manifest, changed: true }
  }
  const assets = listed.assets.map((old) => {
    const mirrored = entry.assets.find((a) => a.backend === old.backend)
    if (!mirrored) throw new Error(`${entry.tag}: ${old.backend} was not mirrored`)
    if (old.validation === 'approved' && old.sha256 !== mirrored.sha256) {
      throw new Error(`${entry.tag}: ${old.backend} is approved, its bytes may not change`)
    }
    return { ...old, sha256: mirrored.sha256, size: mirrored.size }
  })
  const min = options.minCoreVersion ?? listed.min_core_version
  const same =
    min === listed.min_core_version &&
    assets.every((a, i) => a.sha256 === listed.assets[i].sha256 && a.size === listed.assets[i].size)
  if (same) return { manifest, changed: false }
  return { manifest: withRelease(manifest, { ...listed, min_core_version: min, assets }, now), changed: true }
}

/** download_base on the mirror once every listed tag is among `mirroredTags`. */
export function useMirror(manifest, mirroredTags, now) {
  const missing = manifest.releases.map((r) => r.tag).filter((t) => !mirroredTags.includes(t))
  if (missing.length > 0 || manifest.download_base === MIRROR_DOWNLOAD_BASE) {
    return { manifest, changed: false, missing }
  }
  return { manifest: { ...manifest, download_base: MIRROR_DOWNLOAD_BASE, updated_at: now }, changed: true, missing }
}

function listedRelease(manifest, tag) {
  const release = manifest.releases.find((r) => r.tag === tag)
  if (!release) throw new Error(`${tag} is not listed: add it first`)
  return release
}

function withRelease(manifest, release, now) {
  return {
    ...manifest,
    updated_at: now,
    releases: manifest.releases.map((r) => (r.tag === release.tag ? release : r)),
  }
}

/**
 * The manifest with every asset of `tag` approved, companions included, and
 * min_core_version moved when given. `changed` is false when there is nothing
 * to do, so a re-run commits nothing.
 */
export function approveRelease(manifest, tag, options, now) {
  const release = listedRelease(manifest, tag)
  if (release.withdrawn) throw new Error(`${tag} is withdrawn: ${release.withdrawn.reason}`)
  const min = options.minCoreVersion
  if (min !== undefined && !VERSION_RE.test(min)) {
    throw new Error(`--min-core-version must look like 0.18.2 (got "${min}")`)
  }
  const done =
    release.assets.every((a) => a.validation === 'approved') &&
    (min === undefined || release.min_core_version === min)
  if (done) return { manifest, changed: false }
  const approved = {
    ...release,
    min_core_version: min ?? release.min_core_version,
    assets: release.assets.map((a) => ({ ...a, validation: 'approved' })),
  }
  return { manifest: withRelease(manifest, approved, now), changed: true }
}

/** The manifest with `tag` withdrawn for `reason`. */
export function withdrawRelease(manifest, tag, reason, now) {
  if (!reason) throw new Error('A withdrawal needs a --reason')
  const release = listedRelease(manifest, tag)
  return { manifest: withRelease(manifest, { ...release, withdrawn: { reason } }, now), changed: true }
}

/** Why `tag` may not be approved yet, or null when a successful engine-candidate run names it. */
export function prismGateRefusal(runs, tag) {
  if (verifiedRun(runs, tag)) return null
  const last = [...runs]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .find((r) => namesTag(r.displayTitle, tag))
  const seen = !last
    ? 'no engine-candidate run names it'
    : last.status === 'completed'
      ? `its last engine-candidate run concluded ${last.conclusion}: ${last.url}`
      : `its last engine-candidate run is ${last.status}: ${last.url}`
  return (
    `${tag} is not verified: ${seen}. Run core's engine-candidate with engine=atomic-prism ` +
    `and tag=${tag}, or add FORCE=1 to go ahead anyway.`
  )
}

/** Integrity rules the JSON Schema cannot express. Returns a list of errors. */
export function checkPrismManifest(data) {
  const errors = []
  if (data.upstream_repo !== UPSTREAM_REPO) errors.push(`upstream_repo must be ${UPSTREAM_REPO}`)
  const tags = new Set()
  let previousBuild = Infinity
  for (const release of data.releases ?? []) {
    const build = buildOf(release.tag)
    if (build === undefined) {
      errors.push(`Malformed tag: ${release.tag}`)
      continue
    }
    if (tags.has(release.tag)) errors.push(`Duplicate release: ${release.tag}`)
    tags.add(release.tag)
    if (build >= previousBuild) errors.push(`Releases must be listed newest first (${release.tag})`)
    previousBuild = build
    if (!release.commit?.startsWith(release.tag.slice(-7))) {
      errors.push(`Release ${release.tag}: commit ${release.commit} does not match the tag`)
    }
    for (const superseded of release.supersedes ?? []) {
      if (buildOf(superseded) >= build) {
        errors.push(`Release ${release.tag} cannot supersede the same or a newer release ${superseded}`)
      }
    }
    const backends = new Map()
    for (const asset of release.assets ?? []) {
      if (backends.has(asset.backend)) errors.push(`Release ${release.tag}: duplicate backend ${asset.backend}`)
      backends.set(asset.backend, asset)
      const expected = backendForAsset(asset.name, release.tag)
      if (!expected || expected.backend !== asset.backend) {
        errors.push(`Release ${release.tag}: asset ${asset.name} is not backend ${asset.backend}`)
      }
      if (Boolean(expected?.companion) !== (asset.companion === true)) {
        errors.push(`Release ${release.tag}: companion flag of ${asset.backend} does not match its id`)
      }
    }
    for (const asset of backends.values()) {
      if (!asset.companion_backend) continue
      const companion = backends.get(asset.companion_backend)
      if (!companion) {
        errors.push(`Release ${release.tag}: ${asset.backend} needs ${asset.companion_backend}`)
      } else if (asset.validation === 'approved' && companion.validation !== 'approved') {
        errors.push(`Release ${release.tag}: approved ${asset.backend} needs an approved companion`)
      }
    }
    for (const asset of backends.values()) {
      if (/^win-cuda-/.test(asset.backend) && !asset.companion_backend) {
        errors.push(`Release ${release.tag}: ${asset.backend} must name its companion_backend`)
      }
    }
  }
  return errors
}

/** Integrity rules for models/atomic-prism-models.json. Returns a list of errors. */
export function checkPrismModels(data) {
  const errors = []
  const families = new Set()
  const files = new Set()
  for (const family of data.families ?? []) {
    if (families.has(family.id)) errors.push(`Duplicate family: ${family.id}`)
    families.add(family.id)
    const packings = new Set()
    let defaults = 0
    for (const file of family.files ?? []) {
      const key = `${family.repo}/${file.file}`
      if (files.has(key)) errors.push(`Duplicate file: ${key}`)
      files.add(key)
      if (file.default) defaults += 1
      if (file.packing) {
        if (packings.has(file.packing)) errors.push(`${family.id}: two files with packing ${file.packing}`)
        packings.add(file.packing)
      }
      if (file.treatment === 'prism_required' && !(file.requires?.length > 0)) {
        errors.push(`${key}: prism_required needs a non-empty requires`)
      }
      if (file.treatment === 'legacy' && !file.replacement) {
        errors.push(`${key}: a legacy file must name its replacement`)
      }
      if (file.replacement && !(family.files ?? []).some((f) => f.file === file.replacement)) {
        errors.push(`${key}: replacement ${file.replacement} is not a file of ${family.id}`)
      }
      if (file.default && (file.treatment === 'legacy' || file.treatment === 'excluded')) {
        errors.push(`${key}: a ${file.treatment} file cannot be the default`)
      }
    }
    if (defaults !== 1) errors.push(`${family.id}: exactly one file must be the default (found ${defaults})`)
    if (family.default_packing && !packings.has(family.default_packing)) {
      errors.push(`${family.id}: default_packing ${family.default_packing} has no file`)
    }
    for (const projector of family.projectors ?? []) {
      const key = `${family.repo}/${projector.file}`
      if (files.has(key)) errors.push(`Duplicate file: ${key}`)
      files.add(key)
    }
  }
  for (const [id, capability] of Object.entries(data.tensor_types ?? {})) {
    if (!/^[0-9]+$/.test(id)) errors.push(`tensor_types key ${id} must be a ggml type id`)
    if (!CAPABILITIES.includes(capability) && capability !== 'q2_0') {
      errors.push(`tensor_types ${id}: unknown capability ${capability}`)
    }
  }
  return errors
}

async function fetchRelease(path) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'atomic-chat-conf' }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const res = await fetch(`https://api.github.com/repos/${UPSTREAM_REPO}/releases/${path}`, { headers })
  if (!res.ok) throw new Error(`GitHub API ${path}: HTTP ${res.status}`)
  return res.json()
}

function argValue(argv, name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

async function main(argv) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const manifestPath = join(root, 'backends', 'atomic-prism-manifest.json')
  const modelsPath = join(root, 'models', 'atomic-prism-models.json')
  const command = argv[0]
  if (command === 'latest') {
    const release = await fetchRelease('latest')
    process.stdout.write(`${release.tag_name}\n`)
    return 0
  }
  if (command === 'mirrored') {
    const tag = argValue(argv, '--tag')
    const dir = argValue(argv, '--dir')
    if (!TAG_RE.test(tag ?? '') || !dir) throw new Error('Usage: mirrored --tag prism-b<build>-<sha7> --dir <dir>')
    const entry = releaseEntry(await fetchRelease(`tags/${tag}`), { hashes: hashFiles(dir) })
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    const result = upsertMirrored(manifest, entry, { minCoreVersion: argValue(argv, '--min-core-version') }, now)
    if (result.changed) writeFileSync(manifestPath, `${JSON.stringify(result.manifest, null, 2)}\n`)
    process.stdout.write(result.changed ? `listed the mirror of ${tag}\n` : `${tag}: already listed as mirrored\n`)
    return 0
  }
  if (command === 'use-mirror') {
    const file = argValue(argv, '--mirrored')
    if (!file) throw new Error('Usage: use-mirror --mirrored <file with one mirrored tag per line>')
    const mirrored = readFileSync(file, 'utf8').split('\n').map((t) => t.trim()).filter(Boolean)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    const result = useMirror(manifest, mirrored, now)
    if (result.changed) writeFileSync(manifestPath, `${JSON.stringify(result.manifest, null, 2)}\n`)
    process.stdout.write(
      result.changed
        ? `download_base now ${MIRROR_DOWNLOAD_BASE}\n`
        : result.missing.length > 0
          ? `download_base unchanged: not mirrored yet: ${result.missing.join(', ')}\n`
          : 'download_base already points at the mirror\n'
    )
    return 0
  }
  if (command === 'add') {
    const tag = argValue(argv, '--tag')
    if (!TAG_RE.test(tag ?? '')) throw new Error('Usage: add --tag prism-b<build>-<sha7>')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.download_base) {
      throw new Error(`Archives come from ${manifest.download_base}: mirror ${tag} with mirror-prism.yml (make prism-mirror)`)
    }
    const entry = releaseEntry(await fetchRelease(`tags/${tag}`), {
      minCoreVersion: argValue(argv, '--min-core-version'),
    })
    const result = addRelease(manifest, entry, new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'))
    if (result.added) writeFileSync(manifestPath, `${JSON.stringify(result.manifest, null, 2)}\n`)
    process.stdout.write(result.added ? `added ${tag}\n` : `${tag} is already listed\n`)
    return 0
  }
  if (['approve', 'withdraw', 'gate'].includes(command)) {
    const tag = argValue(argv, '--tag')
    if (!TAG_RE.test(tag ?? '')) throw new Error(`Usage: ${command} --tag prism-b<build>-<sha7>`)
    if (command === 'gate') {
      if (argv.includes('--force')) {
        process.stderr.write(`FORCE=1: going ahead with ${tag} without checking for an engine-candidate run\n`)
        return 0
      }
      const runs = listRuns()
      const refusal = prismGateRefusal(runs, tag)
      if (refusal) {
        process.stderr.write(`${refusal}\n`)
        return 1
      }
      const run = verifiedRun(runs, tag)
      process.stdout.write(`${tag} verified: ${run.displayTitle}\n${run.url}\n`)
      return 0
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    const result =
      command === 'approve'
        ? approveRelease(manifest, tag, { minCoreVersion: argValue(argv, '--min-core-version') }, now)
        : withdrawRelease(manifest, tag, argValue(argv, '--reason'), now)
    if (result.changed) writeFileSync(manifestPath, `${JSON.stringify(result.manifest, null, 2)}\n`)
    process.stdout.write(result.changed ? `${command} ${tag}: done\n` : `${tag}: nothing to ${command}\n`)
    return 0
  }
  if (command === 'check') {
    const errors = [
      ...checkPrismManifest(JSON.parse(readFileSync(manifestPath, 'utf8'))),
      ...checkPrismModels(JSON.parse(readFileSync(modelsPath, 'utf8'))),
    ]
    for (const error of errors) process.stderr.write(`::error::${error}\n`)
    if (errors.length === 0) process.stdout.write('Prism manifests OK\n')
    return errors.length === 0 ? 0 : 1
  }
  process.stderr.write(
    'Usage: prism-manifest.mjs latest | add|mirrored|gate|approve|withdraw --tag <tag> [...] | use-mirror | check (see the header)\n'
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
