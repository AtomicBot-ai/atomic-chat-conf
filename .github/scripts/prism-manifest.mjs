#!/usr/bin/env node
// Maintains backends/atomic-prism-manifest.json, the release catalog of the
// atomic-prism provider (PrismML-Eng/llama.cpp builds).
//
//   node .github/scripts/prism-manifest.mjs latest
//       prints the newest PrismML release tag
//   node .github/scripts/prism-manifest.mjs add --tag prism-b10754-2459f68
//       appends that release as `candidate` (no-op when it is already listed)
//   node .github/scripts/prism-manifest.mjs check
//       integrity checks for both Prism manifests (CI and `make validate`)
//
// A release is never approved here: moving an asset from `candidate` to
// `approved` is a reviewed edit made after real-hardware acceptance.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export const UPSTREAM_REPO = 'PrismML-Eng/llama.cpp'
export const DEFAULT_MIN_CORE_VERSION = '0.10.0'
export const TAG_RE = /^prism-b(\d+)-[0-9a-f]{7}$/
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
    const sha256 = sha256FromDigest(asset.digest)
    if (!sha256) throw new Error(`Asset ${asset.name} has no sha256 digest`)
    assets.push({
      backend: id.backend,
      name: asset.name,
      size: asset.size,
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
  if (command === 'add') {
    const tag = argValue(argv, '--tag')
    if (!TAG_RE.test(tag ?? '')) throw new Error('Usage: add --tag prism-b<build>-<sha7>')
    const entry = releaseEntry(await fetchRelease(`tags/${tag}`), {
      minCoreVersion: argValue(argv, '--min-core-version'),
    })
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const result = addRelease(manifest, entry, new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'))
    if (result.added) writeFileSync(manifestPath, `${JSON.stringify(result.manifest, null, 2)}\n`)
    process.stdout.write(result.added ? `added ${tag}\n` : `${tag} is already listed\n`)
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
  process.stderr.write('Usage: prism-manifest.mjs latest | add --tag <tag> [--min-core-version x.y.z] | check\n')
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
