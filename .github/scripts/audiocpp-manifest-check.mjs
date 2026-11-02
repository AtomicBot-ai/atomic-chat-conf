// Integrity checks for backends/audiocpp-manifest.json (and the staging copy
// test builds read) that JSON Schema cannot express. Atomic Chat core installs
// audio.cpp from this manifest; `make validate`, CI and the mirror and approve
// workflows run this file. The live manifest exists only once
// audiocpp-approve.yml has run, so a missing file is skipped; at least one
// must be there. Pass paths as arguments to check other copies instead.
//
// The rules are sd.cpp's (sdcpp-manifest-check.mjs) with audio.cpp's tag form.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const LIVE = 'backends/audiocpp-manifest.json'
export const STAGING = 'backends/audiocpp-manifest.staging.json'

export const TAG_RE = /^v\d+\.\d+\.\d+(-a[0-9a-f]{7})?$/

// The client installs these whenever the host qualifies; a tag that lacks one
// silently degrades every such host to the next tier.
export const REQUIRED = [
  'macos-arm64',
  'win-cuda12-x64',
  'win-vulkan-x64',
  'win-cpu-x64',
  'linux-vulkan-x64',
  'linux-cpu-x64',
]

/** Why the manifest is broken: empty when it is not. */
export function checkManifest(data) {
  const errors = []

  if (typeof data.tag_name !== 'string' || !TAG_RE.test(data.tag_name)) {
    errors.push('tag_name must look like an audio.cpp release tag (e.g. v0.9.3 or v0.9.3-a1b2c3d4)')
  }

  if (data.download_base !== undefined && !/^https:\/\/[^\s]+$/.test(data.download_base)) {
    errors.push('download_base, if present, must be an https URL')
  }

  if (!Array.isArray(data.assets) || data.assets.length === 0) {
    errors.push('assets must be a non-empty array')
    return errors
  }

  const backends = new Set()
  const names = new Set()
  for (const a of data.assets) {
    if (typeof a.backend !== 'string' || !a.backend) {
      errors.push('every asset must have a backend id')
      continue
    }
    if (backends.has(a.backend)) errors.push(`Duplicate backend id: ${a.backend}`)
    backends.add(a.backend)
    if (typeof a.name !== 'string' || !/^[A-Za-z0-9._-]+\.(zip|tar\.gz)$/.test(a.name)) {
      errors.push(`Asset "${a.backend}" has a malformed name: ${a.name}`)
    }
    if (names.has(a.name)) errors.push(`Duplicate asset name: ${a.name}`)
    names.add(a.name)

    // sha256 and size travel together: the client checks the size first and
    // only then pays for the hash.
    if ((a.sha256 !== undefined) !== (a.size !== undefined)) {
      errors.push(`Asset "${a.backend}" must declare sha256 and size together`)
    }
    // The client only pairs the cudart archive with win-cuda12-x64.
    if ((a.backend === 'win-cudart-cu12') !== (a.companion === true)) {
      errors.push(`Asset "${a.backend}" companion flag does not match its id`)
    }
  }
  for (const id of REQUIRED) {
    if (!backends.has(id)) errors.push(`Missing required backend: ${id}`)
  }
  if (backends.has('win-cuda12-x64') && !backends.has('win-cudart-cu12')) {
    errors.push('win-cuda12-x64 needs its win-cudart-cu12 companion')
  }
  // A mirrored release must hash everything it hosts, otherwise the client
  // downloads some archives unverified without saying so.
  if (data.download_base) {
    for (const a of data.assets) {
      if (a.sha256 === undefined) {
        errors.push(`Asset "${a.backend}" is served from download_base but carries no sha256`)
      }
    }
  }
  return errors
}

function main(args) {
  const paths = args.length > 0 ? args : [LIVE, STAGING].filter((path) => existsSync(path))
  if (paths.length === 0) {
    console.error(`Neither ${LIVE} nor ${STAGING} exists`)
    return 1
  }
  let failed = false
  for (const path of paths) {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    const errors = checkManifest(data)
    if (errors.length > 0) {
      console.error(`${path} validation failed:`)
      for (const e of errors) console.error('  - ' + e)
      failed = true
      continue
    }
    console.log(`${path} passed all integrity checks.`)
    console.log(`  tag_name: ${data.tag_name}`)
    console.log(`  assets: ${data.assets.length}`)
    console.log(`  download_base: ${data.download_base ?? `(upstream CDN, ${data.upstream_repo})`}`)
  }
  if (args.length === 0 && !existsSync(LIVE)) {
    console.log(`${LIVE} is not there yet: audiocpp-approve.yml writes it`)
  }
  return failed ? 1 : 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)))
}
