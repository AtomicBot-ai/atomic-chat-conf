#!/usr/bin/env node
// descriptor_id immutability for runtimes/tensorrt-llm.json (R24 / F2).
//
// A published descriptor_id's content must never change: atomic-chat-core
// caches an accepted descriptor by this id and pins an installation to it,
// so editing a published descriptor's fields in place would silently change
// what an already-installed engine is compared against (see README
// "descriptor_id is immutable"). This module compares the working tree's
// descriptor against the same file read from a base git ref and reports a
// failure when the id is unchanged but the content differs — a different
// descriptor_id is exactly how you are supposed to publish a change, so it
// always passes, even if the content also differs.
//
// Used by runtime-descriptor-immutability.test.mjs, which both `make
// validate` and CI run (see README "CI validation" / R15 parity).

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const DEFAULT_PATH = 'runtimes/tensorrt-llm.json'

// Recursively sort object keys so a base file that serializes its keys in a
// different order is not mistaken for changed content; array order is kept
// as-is because order inside an array (curated_models, recipes, notices, …)
// is meaningful.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = canonicalize(value[key])
        return acc
      }, {})
  }
  return value
}

export const canonicalJSON = (value) => JSON.stringify(canonicalize(value))

/**
 * Pure comparison, testable without touching git or disk.
 *
 * - `baseDescriptor === null` (ref or file absent) -> ok
 * - same descriptor_id, canonically same content    -> ok
 * - same descriptor_id, canonically different content -> fail
 * - different descriptor_id                          -> ok (that is how a
 *   change is supposed to be published, regardless of what else changed)
 *
 * @returns {{ ok: boolean, reason: string }}
 */
export function checkDescriptorImmutability(baseDescriptor, currentDescriptor) {
  if (baseDescriptor === null) {
    return {
      ok: true,
      reason: 'no descriptor at the base ref to compare against (ref or file absent)',
    }
  }
  if (baseDescriptor.descriptor_id !== currentDescriptor.descriptor_id) {
    return {
      ok: true,
      reason: `descriptor_id changed ("${baseDescriptor.descriptor_id}" -> "${currentDescriptor.descriptor_id}")`,
    }
  }
  if (canonicalJSON(baseDescriptor) === canonicalJSON(currentDescriptor)) {
    return { ok: true, reason: 'content unchanged' }
  }
  return {
    ok: false,
    reason:
      `descriptor_id "${currentDescriptor.descriptor_id}" is published with different content than it had ` +
      'at the base ref. A published descriptor_id is immutable: publish this change under a new ' +
      'descriptor_id (bump the "-r<N>" suffix, or the engine tag) instead of editing this one in place.',
  }
}

/**
 * Reads `path` (default runtimes/tensorrt-llm.json) at `ref` via `git show`.
 * Returns `null` — meaning "nothing to compare" — when:
 *   - `ref` is falsy or the all-zeros SHA git uses for `github.event.before`
 *     on a push that created a new branch,
 *   - the ref does not exist in this repository, or
 *   - the file does not exist at that ref (e.g. origin/main predates
 *     runtimes/ entirely).
 */
export function readDescriptorAtRef(ref, path = DEFAULT_PATH) {
  if (!ref || /^0+$/.test(ref)) return null
  const result = spawnSync('git', ['show', `${ref}:${path}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  if (result.status !== 0) return null
  try {
    return JSON.parse(result.stdout)
  } catch {
    return null
  }
}
