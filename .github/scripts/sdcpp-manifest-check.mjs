// Integrity checks for backends/sdcpp-manifest.json (and the staging copy
// test builds read) that JSON Schema cannot express. Atomic Chat core installs
// sd.cpp from this manifest; `make validate` and CI both run this file.
import { existsSync, readFileSync } from 'node:fs'

let failed = false
for (const path of ['backends/sdcpp-manifest.json', 'backends/sdcpp-manifest.staging.json']) {
  if (!existsSync(path)) continue
  const data = JSON.parse(readFileSync(path, 'utf8'))
  const errors = []

  if (typeof data.tag_name !== 'string' ||
      !/^master-\d+-[0-9a-f]{7}(-a[0-9a-f]{7})?$/.test(data.tag_name)) {
    errors.push('tag_name must look like a leejet release tag (e.g. master-849-d04e895)')
  }

  if (data.download_base !== undefined &&
      !/^https:\/\/[^\s]+$/.test(data.download_base)) {
    errors.push('download_base, if present, must be an https URL')
  }

  // The client installs these whenever the host qualifies; a tag that
  // lacks one silently degrades every such host to the next tier.
  const REQUIRED = [
    'macos-arm64',
    'win-cuda12-x64',
    'win-vulkan-x64',
    'win-cpu-x64',
    'linux-vulkan-x64',
    'linux-cpu-x64',
  ]

  if (!Array.isArray(data.assets) || data.assets.length === 0) {
    errors.push('assets must be a non-empty array')
  } else {
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

      // sha256 and size travel together: the client checks the size
      // first and only then pays for the hash.
      const hasHash = a.sha256 !== undefined
      const hasSize = a.size !== undefined
      if (hasHash !== hasSize) {
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
    // A mirrored release must hash everything it hosts, otherwise the
    // client downloads some archives unverified without saying so.
    if (data.download_base) {
      for (const a of data.assets) {
        if (a.sha256 === undefined) {
          errors.push(`Asset "${a.backend}" is served from download_base but carries no sha256`)
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error(`${path} validation failed:`)
    for (const e of errors) console.error('  - ' + e)
    failed = true
    continue
  }

  console.log(`${path} passed all integrity checks.`)
  console.log(`  tag_name: ${data.tag_name}`)
  console.log(`  assets: ${data.assets.length}`)
  console.log(`  download_base: ${data.download_base ?? '(upstream CDN)'}`)
}
if (failed) process.exit(1)
