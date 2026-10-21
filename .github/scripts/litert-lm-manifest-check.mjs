// Integrity checks for backends/litert-lm-manifest.json that JSON Schema
// cannot express. Atomic Chat core installs the LiteRT-LM library from this
// manifest; `make validate` and CI both run this file. Pass other paths as
// arguments to check a local copy instead (the comparison with the base ref
// then is skipped).
//
// The real manifest is also compared with itself at a base ref
// (LITERT_LM_BASE_REF, origin/main by default): a published release must not
// change, since a core that installed it keeps its files under that version.
// A fix is a new release on top; removing a broken release is allowed.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { canonicalJSON, readJsonAtRef } from './runtime-descriptor-immutability.mjs'

export const MANIFEST_PATH = 'backends/litert-lm-manifest.json'

// The core picks the wheel by host platform and does not fall back to an
// older release for a single platform, so a release without one of these
// leaves that platform with no library at all.
const PLATFORMS = ['macos-arm64', 'linux-x64', 'linux-arm64', 'win-x64']

// The only NPU path is Intel through OpenVINO, which works on Windows only.
const ACCELERATOR_PLATFORMS = ['win-x64']

export function checkManifest(data) {
  const errors = []
  const releases = Array.isArray(data.releases) ? data.releases : []
  if (releases.length === 0) errors.push('releases must be a non-empty array')

  const versions = new Set()
  let previous = null
  for (const r of releases) {
    if (versions.has(r.version)) errors.push(`Duplicate release version: ${r.version}`)
    versions.add(r.version)

    // The core takes the newest installed release by published_at; a list out
    // of order makes "newest first" in this file lie to whoever edits it next.
    const at = Date.parse(r.published_at)
    if (Number.isNaN(at)) {
      errors.push(`Release ${r.version}: published_at is not a timestamp`)
    } else {
      if (previous && at > previous.at) {
        errors.push(`Release ${r.version} is newer than ${previous.version} above it; releases go newest first`)
      }
      previous = { version: r.version, at }
    }

    const platforms = new Set()
    const names = new Set()
    for (const a of r.assets ?? []) {
      if (platforms.has(a.platform)) errors.push(`Release ${r.version}: duplicate platform ${a.platform}`)
      platforms.add(a.platform)
      if (names.has(a.name)) errors.push(`Release ${r.version}: duplicate asset name ${a.name}`)
      names.add(a.name)
    }
    for (const p of PLATFORMS) {
      if (!platforms.has(p)) errors.push(`Release ${r.version}: missing platform ${p}`)
    }

    const accelerators = new Set()
    for (const x of r.accelerators ?? []) {
      if (accelerators.has(x.id)) errors.push(`Release ${r.version}: duplicate accelerator ${x.id}`)
      accelerators.add(x.id)
      if (!ACCELERATOR_PLATFORMS.includes(x.platform)) {
        errors.push(`Release ${r.version}: accelerator ${x.id} is for ${x.platform}; accelerators are win-x64 only`)
      }
    }
  }
  return errors
}

// Every release present at the base must be unchanged in the current file,
// key order aside. `base === null` (no ref, or no file there yet) passes.
export function checkPublishedReleases(base, current) {
  if (base === null) return []
  const errors = []
  const now = new Map((current.releases ?? []).map((r) => [r.version, r]))
  for (const r of base.releases ?? []) {
    const after = now.get(r.version)
    if (after && canonicalJSON(after) !== canonicalJSON(r)) {
      errors.push(
        `Release ${r.version} is published with different content than at the base ref; ` +
          'publish the fix as a new release on top instead of editing this one'
      )
    }
  }
  return errors
}

function main(args) {
  const paths = args.length > 0 ? args : [MANIFEST_PATH]
  let failed = false
  for (const path of paths) {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    const errors = checkManifest(data)
    if (args.length === 0) {
      const ref = process.env.LITERT_LM_BASE_REF ?? 'origin/main'
      errors.push(...checkPublishedReleases(readJsonAtRef(ref, MANIFEST_PATH), data))
    }

    if (errors.length > 0) {
      console.error(`${path} validation failed:`)
      for (const e of errors) console.error('  - ' + e)
      failed = true
      continue
    }

    console.log(`${path} passed all integrity checks.`)
    console.log(`  releases: ${data.releases.map((r) => r.version).join(', ')}`)
  }
  if (failed) process.exit(1)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2))
}
