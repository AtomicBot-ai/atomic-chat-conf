import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'

// Gate for backends/mlx-manifest.json. Core installs mlx-server from it and
// the desktop Makefile bundles the same build, both straight from the
// AtomicBot-ai/mlx-vlm release: nothing is mirrored here, so the pinned
// sha256/size are the only check on what gets executed, and published_at is
// the only version order (the tag's commit hash has none).
//
// Two halves, both run by `make validate` and CI:
// - the schema itself, run through ajv exactly as `make validate` runs it,
//   against the real manifest and against broken copies;
// - integrity checks as pure functions. They repeat the schema's core rules
//   and add what ajv skips here: with --strict=false (the repo convention)
//   ajv ignores `format`, so a malformed published_at would pass the schema
//   and silently make the build unorderable for core.

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const MANIFEST_PATH = join(REPO_ROOT, 'backends/mlx-manifest.json')
const SCHEMA = 'backends/mlx-schema.json'
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
const clone = (value) => JSON.parse(JSON.stringify(value))

const TAG_RE = /^mlxvlm-macos-arm64-[0-9a-f]{7,40}$/
// RFC 3339 date-time, the form GitHub reports publishedAt in.
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

function checkMlxManifest(m) {
  const errors = []
  if (typeof m.tag_name !== 'string' || !TAG_RE.test(m.tag_name)) {
    errors.push(`tag_name must look like mlxvlm-macos-arm64-<commit>, got ${JSON.stringify(m.tag_name)}`)
  }
  if (typeof m.published_at !== 'string' || !DATE_TIME_RE.test(m.published_at) ||
      Number.isNaN(Date.parse(m.published_at))) {
    errors.push(`published_at must be an RFC 3339 date-time, got ${JSON.stringify(m.published_at)}`)
  }
  if (!Array.isArray(m.assets) || m.assets.length !== 1) {
    errors.push('assets must hold exactly one archive')
    return errors
  }
  const [a] = m.assets
  if (a.backend !== 'macos-arm64') {
    errors.push(`the only asset must be backend "macos-arm64", got ${JSON.stringify(a.backend)}`)
  }
  if (typeof a.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(a.sha256)) {
    errors.push('the asset must carry a hex sha256')
  }
  if (!Number.isInteger(a.size) || a.size < 1) {
    errors.push('the asset must carry a positive integer size')
  }
  return errors
}

const scratch = mkdtempSync(join(tmpdir(), 'mlx-manifest-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

// The exact command `make validate` runs, pointed at a given data file.
const ajv = (dataPath) => {
  const result = spawnSync(
    'npx',
    ['--yes', 'ajv-cli@5', 'validate', '-s', SCHEMA, '-d', dataPath, '--strict=false'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
  if (result.error) throw new Error(`Could not launch "npx": ${result.error.message}`)
  return result
}

const ajvOnCopy = (name, mutate) => {
  const copy = clone(manifest)
  mutate(copy)
  const path = join(scratch, `${name}.json`)
  writeFileSync(path, JSON.stringify(copy))
  return ajv(path)
}

const BROKEN = {
  'no-sha256': (m) => { delete m.assets[0].sha256 },
  'no-size': (m) => { delete m.assets[0].size },
  'tag-latest': (m) => { m.tag_name = 'latest' },
  'two-assets': (m) => { m.assets.push(clone(m.assets[0])) },
  'wrong-backend': (m) => { m.assets[0].backend = 'macos-x64' },
  'no-published-at': (m) => { delete m.published_at },
}

test('the real manifest passes the schema', () => {
  const result = ajv('backends/mlx-manifest.json')
  assert.equal(result.status, 0, result.stderr)
})

test('the real manifest passes the integrity checks', () => {
  assert.deepEqual(checkMlxManifest(manifest), [])
})

for (const [name, mutate] of Object.entries(BROKEN)) {
  test(`schema rejects a copy with ${name}`, () => {
    const result = ajvOnCopy(name, mutate)
    assert.notEqual(result.status, 0, `ajv accepted ${name}:\n${result.stdout}`)
  })

  test(`integrity checks reject a copy with ${name}`, () => {
    const copy = clone(manifest)
    mutate(copy)
    assert.notDeepEqual(checkMlxManifest(copy), [])
  })
}

test('integrity checks reject a malformed published_at the schema lets through', () => {
  const mutate = (m) => { m.published_at = '28.08.2026' }
  assert.equal(ajvOnCopy('bad-date', mutate).status, 0, 'expected ajv to ignore format here')
  const copy = clone(manifest)
  mutate(copy)
  assert.match(checkMlxManifest(copy).join('\n'), /published_at/)
})
