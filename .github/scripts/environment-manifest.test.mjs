import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

// Schema-shape half of the gate for runtimes/environments/linux.json, the same
// way runtime-descriptor.test.mjs is for the engine descriptor: this runs the
// exact ajv command `make validate` runs for the real manifest, against
// fixtures, so a green test means the gate itself works.
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SCHEMA = 'runtimes/environments/linux.schema.json'
const STRICT = 'true'

const runAjv = (binary, args) => {
  const result = spawnSync(binary, args, { cwd: REPO_ROOT, encoding: 'utf8' })
  if (result.error) {
    throw new Error(`Could not launch "${binary}": ${result.error.message}`)
  }
  return result
}

const validate = (fixture) =>
  runAjv('npx', [
    '--yes',
    'ajv-cli@5',
    'validate',
    '-s',
    SCHEMA,
    '-d',
    `.github/fixtures/runtimes/environments/${fixture}`,
    `--strict=${STRICT}`,
  ])

test('valid environment manifest passes schema validation', () => {
  const result = validate('valid.json')
  assert.equal(result.status, 0, result.stderr)
})

const invalid = [
  ['invalid-recipe-command.json', 'recipe carrying a command-like field'],
  ['invalid-unknown-top-level-field.json', 'unknown top-level field'],
  ['invalid-schema-field.json', 'manifest carries a $schema key (core\'s strict parser rejects every unknown top-level key)'],
  ['invalid-empty-distributions.json', 'recipe with an empty distributions list'],
  ['invalid-manifest-id.json', 'manifest_id not of the form linux-r<N>'],
]

for (const [fixture, defect] of invalid) {
  test(`rejects: ${defect}`, () => {
    const result = validate(fixture)
    assert.notEqual(result.status, 0, `expected ${fixture} to fail schema validation`)
  })
}
