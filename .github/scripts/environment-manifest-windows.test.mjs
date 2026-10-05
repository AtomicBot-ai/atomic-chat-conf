import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

// Schema-shape half of the gate for runtimes/environments/windows.json, the
// same way environment-manifest.test.mjs is for linux.json: this runs the
// exact ajv command `make validate` runs for the real manifest, against
// fixtures, so a green test means the gate itself works.
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SCHEMA = 'runtimes/environments/windows.schema.json'
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

test('valid Windows environment manifest passes schema validation', () => {
  const result = validate('windows-valid.json')
  assert.equal(result.status, 0, result.stderr)
})

const invalid = [
  ['windows-invalid-rootfs-no-sha256.json', 'rootfs without sha256'],
  ['windows-invalid-rootfs-short-sha256.json', 'rootfs sha256 that is not 64 hex characters'],
  ['windows-invalid-rootfs-http-url.json', 'rootfs url over plain http://'],
  ['windows-invalid-unknown-top-level-field.json', 'unknown top-level field'],
  ['windows-invalid-rootfs-command.json', 'rootfs carrying a command-like field'],
  ['windows-invalid-schema-field.json', 'manifest carries a $schema key (core\'s strict parser rejects every unknown top-level key)'],
  ['windows-invalid-manifest-id.json', 'manifest_id not of the form windows-r<N>'],
  ['windows-invalid-rootfs-arch.json', 'rootfs for an architecture other than x86_64'],
]

for (const [fixture, defect] of invalid) {
  test(`rejects: ${defect}`, () => {
    const result = validate(fixture)
    assert.notEqual(result.status, 0, `expected ${fixture} to fail schema validation`)
  })
}
