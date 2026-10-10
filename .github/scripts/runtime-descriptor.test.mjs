import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { listDescriptorPaths } from './runtime-descriptor-files.mjs'

// Schema gate for every engine descriptor. `make validate` and CI run this file instead of naming
// each runtimes/<engine_id>.json in an ajv step, so a descriptor added for a new engine is checked
// the moment it lands (see runtime-descriptor-files.mjs). The ajv command below is the same one the
// gate used to run per file, so a green test here means the descriptors themselves pass.
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

const validatePath = (path) =>
  runAjv('npx', ['--yes', 'ajv-cli@5', 'validate', '-s', SCHEMA, '-d', path, `--strict=${STRICT}`])

const validate = (fixture) => validatePath(`.github/fixtures/runtimes/${fixture}`)

const descriptorPaths = listDescriptorPaths()

test('runtimes/ holds at least one descriptor and the listing skips schema.json', () => {
  assert.ok(descriptorPaths.length >= 1, 'no descriptor found under runtimes/')
  assert.ok(!descriptorPaths.includes('runtimes/schema.json'))
})

for (const path of descriptorPaths) {
  test(`${path} passes schema validation`, () => {
    const result = validatePath(path)
    assert.equal(result.status, 0, result.stderr)
  })
}

// "Новый дескриптор проверяется без правки CI": a catalog directory whose only descriptor
// (vllm.json) breaks the schema and is named nowhere in this file or in CI — discovering it is
// what catches it.
test('a schema-invalid descriptor is found and rejected without being named anywhere', () => {
  const paths = listDescriptorPaths('.github/fixtures/runtimes/catalogs/unnamed-invalid')
  assert.deepEqual(paths, ['.github/fixtures/runtimes/catalogs/unnamed-invalid/vllm.json'])
  const result = validatePath(paths[0])
  assert.notEqual(result.status, 0, 'expected the undiscovered-by-name descriptor to fail schema validation')
})

for (const fixture of ['valid.json', 'valid-vllm.json']) {
  test(`valid fixture ${fixture} passes schema validation`, () => {
    const result = validate(fixture)
    assert.equal(result.status, 0, result.stderr)
  })
}

const invalid = [
  ['invalid-missing-digest.json', 'image digest missing for one platform'],
  ['invalid-tag-instead-of-digest.json', 'image referenced by tag instead of digest'],
  ['invalid-recipes.json', 'descriptor carrying recipes (environment data lives in runtimes/environments/, not in an engine descriptor)'],
  ['invalid-malformed-probe-digest.json', 'probe_image with a malformed digest'],
  ['invalid-unknown-top-level-field.json', 'unknown top-level field'],
  ['invalid-parser-leading-dash.json', 'parser name starting with - (would be read as a flag)'],
  ['invalid-tag-with-digest.json', 'image repository carries a tag even though a valid digest is also present'],
  ['invalid-schema-field.json', 'descriptor carries a $schema key (core\'s ported parser rejects every unknown top-level key)'],
  ['invalid-missing-minimum-driver-version.json', 'missing required minimum_driver_version'],
  ['invalid-quantization-missing-excluded-cc.json', 'quantization entry without excluded_compute_capabilities'],
  ['invalid-excluded-cc-duplicate.json', 'duplicate compute capability within one excluded_compute_capabilities'],
  ['invalid-malformed-driver-version.json', 'malformed minimum_driver_version (leading "v")'],
  ['invalid-descriptor-id-latest.json', 'descriptor_id not of the form <engine_id>-<version>-r<n> (vllm-latest)'],
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
