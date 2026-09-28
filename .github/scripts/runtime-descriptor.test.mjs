import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

// This is the exact command `make validate` will run for the real descriptor (task 1.2), so a
// green test here means the gate itself would pass, not just some approximation of it.
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SCHEMA = 'runtimes/schema.json'
const STRICT = 'true'

// spawnSync sets `result.error` (and leaves `status` null) when the binary
// itself could not be launched (e.g. npx missing) — distinct from the binary
// running and exiting non-zero. Surfacing that case explicitly means a broken
// environment fails with "could not launch npx", not a misleading assertion
// about an empty stderr.
const runAjv = (binary, args) => {
  const result = spawnSync(binary, args, { cwd: REPO_ROOT, encoding: 'utf8' })
  if (result.error) {
    throw new Error(`Could not launch "${binary}": ${result.error.message}`)
  }
  return result
}

const validate = (fixture) =>
  runAjv('npx', ['--yes', 'ajv-cli@5', 'validate', '-s', SCHEMA, '-d', `.github/fixtures/runtimes/${fixture}`, `--strict=${STRICT}`])

test('valid descriptor passes schema validation', () => {
  const result = validate('valid.json')
  assert.equal(result.status, 0, result.stderr)
})

const invalid = [
  ['invalid-missing-digest.json', 'image digest missing for one platform'],
  ['invalid-tag-instead-of-digest.json', 'image referenced by tag instead of digest'],
  ['invalid-recipe-command.json', 'recipe carrying a command-like field'],
  ['invalid-malformed-probe-digest.json', 'probe_image with a malformed digest'],
  ['invalid-unknown-top-level-field.json', 'unknown top-level field'],
  ['invalid-parser-leading-dash.json', 'parser name starting with - (would be read as a flag)'],
  ['invalid-tag-with-digest.json', 'image repository carries a tag even though a valid digest is also present'],
  ['invalid-schema-field.json', 'descriptor carries a $schema key (core\'s ported parser rejects every unknown top-level key)'],
  ['invalid-missing-minimum-driver-version.json', 'missing required minimum_driver_version'],
]

for (const [fixture, defect] of invalid) {
  test(`rejects: ${defect}`, () => {
    const result = validate(fixture)
    assert.notEqual(result.status, 0, `expected ${fixture} to fail schema validation`)
  })
}

test('validate() surfaces a spawn launch failure with a clear message (e.g. npx missing)', () => {
  assert.throws(
    () => runAjv('this-binary-does-not-exist-xyz', ['--version']),
    /Could not launch "this-binary-does-not-exist-xyz"/
  )
})
