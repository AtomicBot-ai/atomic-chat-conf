#!/usr/bin/env node
// Helper for .github/workflows/mirror-upstream.yml.
//
//   select   --tag b10405 [--out assets.json]
//              Resolve which ggml-org/llama.cpp assets we mirror for a tag.
//   manifest --tag b10405 --dir <signed-assets-dir> [--out backends/manifest.json]
//              Regenerate backends/manifest.json from the assets that were
//              actually published, hashing each one.
//
// Asset names are matched by pattern rather than spelled out: upstream moves
// the CUDA and ROCm minor versions between releases (win-cuda-13.3 -> 13.4,
// win-rocm-7.14 -> ...), so a literal list would silently mirror nothing.

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const UPSTREAM_REPO = 'ggml-org/llama.cpp'
const GGML_ORG_DOWNLOAD_BASE =
  'https://github.com/ggml-org/llama.cpp/releases/download'
const MIRROR_DOWNLOAD_BASE =
  'https://github.com/AtomicBot-ai/atomic-chat-conf/releases/download'

// What the Atomic Chat backend matrix can actually use. Everything else that
// upstream publishes (android, xcframework, ui, s390x, sycl, openvino, arm64
// Windows/Linux, macos-x64) is deliberately absent: mirroring a build no
// client asks for costs release storage and buys nothing.
//
// `required: false` marks a variant upstream only started shipping recently.
// A tag that predates it still mirrors fine; the client's matrix simply will
// not offer that tier for that tag.
const WHITELIST = [
  { platform: 'windows', pattern: 'win-cpu-x64\\.zip', required: true },
  {
    platform: 'windows',
    pattern: 'win-cuda-\\d+\\.\\d+-x64\\.zip',
    required: true,
  },
  { platform: 'windows', pattern: 'win-vulkan-x64\\.zip', required: true },
  {
    platform: 'windows',
    pattern: 'win-rocm-[\\d.]+-x64\\.zip',
    required: false,
  },
  { platform: 'linux', pattern: 'ubuntu-x64\\.tar\\.gz', required: true },
  {
    platform: 'linux',
    pattern: 'ubuntu-vulkan-x64\\.tar\\.gz',
    required: true,
  },
  { platform: 'macos', pattern: 'macos-arm64\\.tar\\.gz', required: true },
]

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      out[arg.slice(2)] = argv[i + 1]
      i++
    } else {
      out._.push(arg)
    }
  }
  return out
}

function assertTag(tag) {
  if (!tag || !/^b\d+$/.test(tag)) {
    throw new Error(`--tag must look like a ggml-org release tag (got "${tag}")`)
  }
  return tag
}

async function fetchUpstreamRelease(tag) {
  const url = `https://api.github.com/repos/${UPSTREAM_REPO}/releases/tags/${tag}`
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'atomic-chat-conf-mirror',
  }
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  }
  const resp = await fetch(url, { headers })
  if (!resp.ok) {
    throw new Error(
      `GitHub API ${resp.status} for ${UPSTREAM_REPO} tag ${tag}: ${await resp.text()}`
    )
  }
  return resp.json()
}

function selectAssets(tag, upstreamAssets) {
  const selected = []
  const missing = []

  for (const entry of WHITELIST) {
    const re = new RegExp(`^llama-${tag}-bin-${entry.pattern}$`)
    const matches = upstreamAssets.filter((a) => re.test(a.name))
    if (matches.length === 0) {
      if (entry.required) missing.push(re.source)
      continue
    }
    for (const match of matches) {
      selected.push({
        name: match.name,
        size: match.size,
        platform: entry.platform,
        url: `${GGML_ORG_DOWNLOAD_BASE}/${tag}/${match.name}`,
      })
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Upstream tag ${tag} is missing required assets:\n  ${missing.join('\n  ')}`
    )
  }

  return selected.sort((a, b) => a.name.localeCompare(b.name))
}

async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

/**
 * The CUDA runtime companions stay on the ggml-org CDN: the DLLs inside are
 * NVIDIA's own, already signed by NVIDIA, and re-signing them would triple
 * the size of every mirrored tag for no gain. They carry no `sha256` here,
 * which is what marks an asset as "not mirrored" for readers of this file.
 */
function cudartCompanions(mirroredNames) {
  const versions = new Set()
  for (const name of mirroredNames) {
    const match = /-bin-win-cuda-(\d+\.\d+)-x64\.zip$/.exec(name)
    if (match) versions.add(match[1])
  }
  return [...versions]
    .sort()
    .map((v) => ({ name: `cudart-llama-bin-win-cuda-${v}-x64.zip` }))
}

async function cmdSelect(args) {
  const tag = assertTag(args.tag)
  const release = await fetchUpstreamRelease(tag)
  const selected = selectAssets(tag, release.assets ?? [])
  const payload = { tag, assets: selected }
  const json = JSON.stringify(payload, null, 2)

  if (args.out) await writeFile(args.out, json + '\n')
  else process.stdout.write(json + '\n')

  const total = selected.reduce((sum, a) => sum + a.size, 0)
  process.stderr.write(
    `Selected ${selected.length} asset(s) for ${tag}, ${(total / 1024 ** 2).toFixed(1)} MiB total\n`
  )
  for (const a of selected) {
    process.stderr.write(
      `  ${a.platform.padEnd(8)} ${a.name} (${(a.size / 1024 ** 2).toFixed(1)} MiB)\n`
    )
  }
}

async function cmdManifest(args) {
  const tag = assertTag(args.tag)
  if (!args.dir) throw new Error('--dir is required')

  const entries = (await readdir(args.dir, { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.startsWith(`llama-${tag}-bin-`))
    .map((e) => e.name)
    .sort()

  if (entries.length === 0) {
    throw new Error(`No llama-${tag}-bin-* archives found under ${args.dir}`)
  }

  const assets = []
  for (const name of entries) {
    const path = join(args.dir, name)
    const { size } = await stat(path)
    assets.push({ name, sha256: await sha256File(path), size })
  }
  assets.push(...cudartCompanions(entries))

  const manifest = {
    $schema: './schema.json',
    updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    tag_name: tag,
    download_base: args.downloadBase ?? MIRROR_DOWNLOAD_BASE,
    assets,
  }

  const out = args.out ?? 'backends/manifest.json'
  await writeFile(out, JSON.stringify(manifest, null, 2) + '\n')
  process.stderr.write(
    `Wrote ${out}: tag ${tag}, ${assets.length} asset(s), base ${manifest.download_base}\n`
  )
}

const COMMANDS = { select: cmdSelect, manifest: cmdManifest }

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const command = COMMANDS[args._[0]]
  if (!command) {
    process.stderr.write(
      `Usage: mirror.mjs <${Object.keys(COMMANDS).join('|')}> --tag <tag> [...]\n`
    )
    process.exit(2)
  }
  await command(args)
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`)
  process.exit(1)
})
