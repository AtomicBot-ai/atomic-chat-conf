#!/usr/bin/env node
// inventory_digest for a curated model in runtimes/*.json.
//
//   node .github/scripts/inventory-digest.mjs <owner/name> <revision>
//
// Fetches the repository's file list at exactly <revision> from the Hugging
// Face API and prints `sha256:<hex>` on stdout (the revision the API resolved
// goes to stderr). No token is sent: curated models must be ungated.
//
// This is a port of atomic-chat-core's `inventoryDigest`
// (src/models/snapshot-plan.ts) and of the sibling mapping in its
// src/models/hf.ts (same endpoint, lfs.size before size, lfs.sha256 as the
// published digest). core recomputes the digest from the same listing and
// compares, so the two must stay byte-for-byte identical; the test vectors in
// inventory-digest.test.mjs come from running core's own code.

import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const NUL = String.fromCharCode(0)

const safeSize = (value) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined

// Files sorted by path (UTF-16 code unit order, as JS `<` compares); per file
// `${path.length}:${path}` + `|${bytes}|` + (published sha256 or '') + NUL.
// Length-prefixed so `a`+`bc` and `ab`+`c` cannot collide.
export function inventoryDigest(files) {
  if (files.length === 0) throw new Error('A checkpoint with no files is not a checkpoint.')
  const seen = new Set()
  const hash = createHash('sha256')
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  for (const file of sorted) {
    if (typeof file.path !== 'string' || file.path === '' || file.path.includes(NUL)) {
      throw new Error(`An artifact's file path cannot be empty: ${JSON.stringify(file.path)}`)
    }
    if (seen.has(file.path)) throw new Error(`The inventory lists a file twice: ${file.path}`)
    seen.add(file.path)
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) {
      throw new Error(`A file size is not a whole number: ${file.path}`)
    }
    hash.update(`${file.path.length}:${file.path}`)
    hash.update(`|${file.bytes}|`)
    hash.update(file.sha256 ?? '')
    hash.update(NUL)
  }
  return `sha256:${hash.digest('hex')}`
}

// Every sibling is part of the inventory (core's GGUF filter is a selection
// step for the llama.cpp path, not part of identity).
export function filesFromHfSiblings(siblings) {
  return siblings.map((sibling) => {
    const lfs = sibling.lfs && typeof sibling.lfs === 'object' ? sibling.lfs : {}
    const bytes = safeSize(lfs.size) ?? safeSize(sibling.size) ?? 0
    const sha256 = typeof lfs.sha256 === 'string' && lfs.sha256 ? lfs.sha256 : undefined
    return { path: sibling.rfilename, bytes, ...(sha256 ? { sha256 } : {}) }
  })
}

async function main([repo, revision]) {
  if (!repo || !revision || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    console.error('Usage: node .github/scripts/inventory-digest.mjs <owner/name> <revision>')
    process.exit(2)
  }
  const url = `https://huggingface.co/api/models/${repo}/revision/${encodeURIComponent(revision)}?blobs=true&files_metadata=true`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Hugging Face returned HTTP ${response.status} for ${url}`)
  const body = await response.json()
  if (!Array.isArray(body.siblings)) throw new Error('Unexpected Hugging Face response: no siblings')
  if (/^[0-9a-f]{40}$/.test(revision) && body.sha !== revision) {
    throw new Error(`Asked for ${revision}, Hugging Face answered with ${body.sha}`)
  }
  console.error(`revision ${body.sha}`)
  console.log(inventoryDigest(filesFromHfSiblings(body.siblings)))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
