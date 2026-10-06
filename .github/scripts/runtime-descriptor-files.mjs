// Which files under runtimes/ are engine descriptors.
//
// One descriptor per managed engine, named after it: runtimes/<engine_id>.json
// (tensorrt-llm.json, vllm.json, …), next to the one shared runtimes/schema.json.
// The schema, integrity and immutability tests discover descriptors through
// listDescriptorPaths instead of naming them, so a new engine's descriptor is
// checked by `make validate` and CI the moment it lands — no CI edit, and no
// way to add a descriptor that the gate silently skips.
//
// Only the top level of the directory is read: runtimes/environments/ holds
// environment manifests, which have their own schemas and tests.

import { readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
export const RUNTIMES_DIR = 'runtimes'
const SCHEMA_FILE = 'schema.json'

/**
 * Repo-relative paths of every descriptor in `dir` (relative to the repo
 * root), sorted so test output is stable.
 */
export function listDescriptorPaths(dir = RUNTIMES_DIR) {
  return readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== SCHEMA_FILE)
    .map((entry) => join(dir, entry.name))
    .sort()
}

/** The engine a descriptor file is named after: runtimes/vllm.json -> "vllm". */
export const engineIdFromPath = (path) => basename(path, '.json')
