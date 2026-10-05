import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

// Schema-shape gate for runtimes/environments/windows-arm64.json, the Windows
// on Arm manifest, as environment-manifest-windows.test.mjs is for
// windows.json: the exact ajv command `make validate` runs, against fixtures.
// Its own file and schema because every released core parses windows.json
// strictly and would refuse an arm64 rootfs there.
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SCHEMA = 'runtimes/environments/windows-arm64.schema.json'

const validate = (fixture) => {
  const result = spawnSync(
    'npx',
    ['--yes', 'ajv-cli@5', 'validate', '-s', SCHEMA, '-d', `.github/fixtures/runtimes/environments/${fixture}`, '--strict=true'],
    { cwd: REPO_ROOT, encoding: 'utf8' }
  )
  if (result.error) throw new Error(`Could not launch npx: ${result.error.message}`)
  return result
}

test('valid Windows on Arm environment manifest passes schema validation', () => {
  const result = validate('windows-arm64-valid.json')
  assert.equal(result.status, 0, result.stderr)
})

const invalid = [
  ['windows-arm64-invalid-rootfs-arch.json', 'an x86_64 rootfs in the arm64 manifest'],
  ['windows-arm64-invalid-manifest-id.json', 'manifest_id not of the form windows-arm64-r<N>'],
  ['windows-valid.json', 'the x64 manifest validated as the arm64 one'],
]

for (const [fixture, defect] of invalid) {
  test(`rejects: ${defect}`, () => {
    const result = validate(fixture)
    assert.notEqual(result.status, 0, `expected ${fixture} to fail schema validation`)
  })
}
