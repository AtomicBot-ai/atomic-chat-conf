// Integrity checks for backends/foundry-local-manifest.json that JSON Schema
// cannot express. Atomic Chat core installs the Foundry Local runtime from
// this manifest; `make validate` and CI both run this file. Pass other paths
// as arguments to check a local copy instead.
import { readFileSync } from 'node:fs'

// The core picks the archive by host platform. A release without one of these
// leaves that platform with no runtime at all, since the core does not fall
// back to an older release for a single platform.
const PLATFORMS = ['win-x64', 'win-arm64', 'macos-arm64', 'linux-x64', 'linux-arm64']

const paths = process.argv.slice(2)
if (paths.length === 0) paths.push('backends/foundry-local-manifest.json')

let failed = false
for (const path of paths) {
  const data = JSON.parse(readFileSync(path, 'utf8'))
  const errors = []
  const releases = Array.isArray(data.releases) ? data.releases : []
  if (releases.length === 0) errors.push('releases must be a non-empty array')

  const tags = new Set()
  let previous = null
  for (const r of releases) {
    if (tags.has(r.tag)) errors.push(`Duplicate release tag: ${r.tag}`)
    tags.add(r.tag)

    // The core takes the newest installed release by published_at; a list out
    // of order makes "newest first" in this file lie to whoever edits it next.
    const at = Date.parse(r.published_at)
    if (Number.isNaN(at)) {
      errors.push(`Release ${r.tag}: published_at is not a timestamp`)
    } else {
      if (previous && at > previous.at) {
        errors.push(`Release ${r.tag} is newer than ${previous.tag} above it; releases go newest first`)
      }
      previous = { tag: r.tag, at }
    }

    const platforms = new Set()
    const names = new Set()
    for (const a of r.assets ?? []) {
      if (platforms.has(a.platform)) errors.push(`Release ${r.tag}: duplicate platform ${a.platform}`)
      platforms.add(a.platform)
      if (names.has(a.name)) errors.push(`Release ${r.tag}: duplicate asset name ${a.name}`)
      names.add(a.name)
    }
    for (const p of PLATFORMS) {
      if (!platforms.has(p)) errors.push(`Release ${r.tag}: missing platform ${p}`)
    }
  }

  if (errors.length > 0) {
    console.error(`${path} validation failed:`)
    for (const e of errors) console.error('  - ' + e)
    failed = true
    continue
  }

  console.log(`${path} passed all integrity checks.`)
  console.log(`  releases: ${releases.map((r) => r.tag).join(', ')}`)
}
if (failed) process.exit(1)
