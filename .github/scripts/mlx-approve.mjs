#!/usr/bin/env node
// Moves a checked MLX build from the staging manifest to the live one
// (mlx-approve.yml).
//
//   check --tag mlxvlm-macos-arm64-a1b2c3d --conf-sha <40 hex>
//       fail unless backends/mlx-manifest.staging.json at that commit names the
//       tag, downloads from this repository, and its archive is in this
//       repository's release of the tag with the same size and sha256 (the
//       release's own digest)
//   approve --tag mlxvlm-macos-arm64-a1b2c3d --conf-sha <40 hex>
//       write that staging manifest to backends/mlx-manifest.json
//
// mirror-mlx.yml (by default into backends/mlx-manifest.staging.json) copies the
// fork's signed and notarized build into a release here and writes the staging
// manifest; core's engine-candidate checks that release and records the conf
// commit it read (results.json conf.sha). The live manifest gets the staging
// manifest of that commit, not of main: a newer candidate may hold the slot by
// now.
//
// Released cores accept only tag_name ^mlxvlm-macos-arm64-[0-9a-f]{7,40}$ and
// build the download URL from upstream_repo, so a mirrored build is named
// mlxvlm-macos-arm64-<rev> (rev: the fork commit it was built at) and its
// manifest names this repository. The manifest has no updated_at (the schema
// allows none): cores order MLX builds by published_at, the mirror release's.

import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MIRROR_REPO } from './upstream-releases.mjs'

export const TAG_RE = /^mlxvlm-macos-arm64-[0-9a-f]{7}$/
export const CONF_SHA_RE = /^[0-9a-f]{40}$/
export const LIVE = 'backends/mlx-manifest.json'
export const STAGING = 'backends/mlx-manifest.staging.json'

/**
 * Why the staged manifest may not go live as the tag: empty when it may.
 * `release` is this repository's release of the tag, as the GitHub API gives it.
 */
export function stagedRefusals(staged, tag, release) {
  const errors = []
  if (staged.tag_name !== tag) errors.push(`${STAGING} names ${staged.tag_name}, not ${tag}`)
  // The digests below are checked against this repository's release only.
  if (staged.upstream_repo !== MIRROR_REPO) {
    errors.push(`upstream_repo is ${staged.upstream_repo}, not ${MIRROR_REPO}`)
  }
  if (!Array.isArray(staged.assets) || staged.assets.length === 0) errors.push('the manifest lists no archive')
  const published = new Map((release.assets ?? []).map((a) => [a.name, a]))
  for (const asset of staged.assets ?? []) {
    const ours = published.get(asset.name)
    if (!ours) {
      errors.push(`${asset.name} is not in release ${tag}`)
      continue
    }
    if (ours.size !== asset.size) errors.push(`${asset.name}: ${asset.size} bytes listed, ${ours.size} released`)
    if (ours.digest !== `sha256:${asset.sha256}`) {
      errors.push(`${asset.name}: sha256:${asset.sha256} listed, ${ours.digest ?? 'no digest'} released`)
    }
  }
  return errors
}

function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    throw new Error(`${command} ${args.slice(0, 2).join(' ')}: ${String(err.stderr ?? err.message).trim()}`)
  }
}

// A commit main never had could stage anything: only one the checkout
// descends from goes live.
function stagedAt(sha) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { stdio: 'ignore' })
  } catch {
    throw new Error(`${sha} is not a commit of this branch: approve a staging manifest main published`)
  }
  return JSON.parse(run('git', ['show', `${sha}:${STAGING}`]))
}

const argValue = (argv, name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

function main(argv) {
  const command = argv[0]
  if (command !== 'check' && command !== 'approve') {
    process.stderr.write('Usage: mlx-approve.mjs check|approve --tag <tag> --conf-sha <sha> (see the header)\n')
    return 2
  }
  const tag = argValue(argv, '--tag')
  const sha = argValue(argv, '--conf-sha')
  if (!TAG_RE.test(tag ?? '')) throw new Error(`--tag must look like mlxvlm-macos-arm64-a1b2c3d (got "${tag}")`)
  if (!CONF_SHA_RE.test(sha ?? '')) throw new Error(`--conf-sha must be a 40-character commit hash (got "${sha}")`)
  const staged = stagedAt(sha)

  if (command === 'check') {
    const release = JSON.parse(run('gh', ['api', `repos/${MIRROR_REPO}/releases/tags/${tag}`]))
    const errors = stagedRefusals(staged, tag, release)
    for (const error of errors) process.stderr.write(`::error::${error}\n`)
    if (errors.length > 0) return 1
    process.stdout.write(`${STAGING} at ${sha.slice(0, 7)}: ${tag}, ${staged.assets.length} archive(s) match the release\n`)
    return 0
  }

  // `check` ran first in the workflow; this only refuses a mixed-up pair.
  if (staged.tag_name !== tag) throw new Error(`${STAGING} at ${sha} names ${staged.tag_name}, not ${tag}`)
  writeFileSync(LIVE, `${JSON.stringify(staged, null, 2)}\n`)
  process.stdout.write(`${LIVE}: ${tag} from ${sha.slice(0, 7)}\n`)
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }
}
