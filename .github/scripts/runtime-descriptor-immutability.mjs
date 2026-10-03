#!/usr/bin/env node
// Published-id immutability for the documents under runtimes/: the engine
// descriptor runtimes/tensorrt-llm.json (descriptor_id, R24 / F2) and every
// environment manifest under runtimes/environments/ (manifest_id).
//
// A published id's content must never change: atomic-chat-core caches an
// accepted document by its id and pins an installation (descriptor) or an
// operation (manifest) to it, so editing a published document in place would
// silently change what core compares against (see README "descriptor_id is
// immutable" and "manifest_id is immutable"). This module compares the
// working tree's document against the same file read from a base git ref and
// reports a failure when the id is unchanged but the content differs — a
// different id is exactly how you are supposed to publish a change, so it
// always passes, even if the content also differs.
//
// Used by runtime-descriptor-immutability.test.mjs and
// environment-manifest-immutability.test.mjs, which both `make validate` and
// CI run (see README "CI validation" / R15 parity).

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
export const DESCRIPTOR_PATH = 'runtimes/tensorrt-llm.json'
// One file per platform; a new platform's manifest joins this list and gets
// the same check without a new test file.
export const ENVIRONMENT_MANIFEST_PATHS = [
  'runtimes/environments/linux.json',
  'runtimes/environments/windows.json',
  'runtimes/environments/windows-arm64.json',
]

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
 * Pure comparison, testable without touching git or disk. `idField` names the
 * document's immutable id (descriptor_id, manifest_id).
 *
 * - `base === null` (ref or file absent)     -> ok
 * - same id, canonically same content        -> ok
 * - same id, canonically different content   -> fail
 * - different id                             -> ok (that is how a change is
 *   supposed to be published, regardless of what else changed)
 *
 * @returns {{ ok: boolean, reason: string }}
 */
export function checkIdImmutability(base, current, idField) {
  if (base === null) {
    return {
      ok: true,
      reason: 'no document at the base ref to compare against (ref or file absent)',
    }
  }
  if (base[idField] !== current[idField]) {
    return {
      ok: true,
      reason: `${idField} changed ("${base[idField]}" -> "${current[idField]}")`,
    }
  }
  if (canonicalJSON(base) === canonicalJSON(current)) {
    return { ok: true, reason: 'content unchanged' }
  }
  return {
    ok: false,
    reason:
      `${idField} "${current[idField]}" is published with different content than it had ` +
      `at the base ref. A published ${idField} is immutable: publish this change under a new ` +
      `${idField} (bump the "-r<N>" suffix) instead of editing this one in place.`,
  }
}

export const checkDescriptorImmutability = (base, current) =>
  checkIdImmutability(base, current, 'descriptor_id')

export const checkManifestImmutability = (base, current) =>
  checkIdImmutability(base, current, 'manifest_id')

/**
 * Reads the JSON file at `path` at `ref` via `git show`. Returns `null` —
 * meaning "nothing to compare" — when:
 *   - `ref` is falsy or the all-zeros SHA git uses for `github.event.before`
 *     on a push that created a new branch,
 *   - the ref does not exist in this repository, or
 *   - the file does not exist at that ref (e.g. origin/main predates
 *     runtimes/ entirely).
 */
export function readJsonAtRef(ref, path) {
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

export const readDescriptorAtRef = (ref, path = DESCRIPTOR_PATH) => readJsonAtRef(ref, path)
