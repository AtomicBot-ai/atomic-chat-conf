import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const checker = fileURLToPath(new URL('./foundry-local-manifest-check.mjs', import.meta.url))
const candidate = JSON.parse(readFileSync(new URL('../../backends/foundry-local-manifest.candidate.json', import.meta.url), 'utf8'))
function check(name) {
  const dir = mkdtempSync(join(tmpdir(), 'atomic-foundry-npu-manifest-'))
  try {
    const manifest = structuredClone(candidate)
    manifest.releases[0].assets.find(asset => asset.platform === 'win-x64').name = name
    const path = join(dir, 'manifest.json')
    writeFileSync(path, JSON.stringify(manifest))
    return spawnSync(process.execPath, [checker, path], { encoding: 'utf8' })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
for (const name of ['foundry-local-win-x64.zip', 'foundry-local-win-x64-openvino-1-8-1.zip']) {
  test(`accepts the qualified Windows archive ${name}`, () => {
    const result = check(name)
    assert.equal(result.status, 0, result.stderr)
  })
}
test('rejects unqualified Windows archive suffixes', () => {
  const result = check('foundry-local-win-x64-openvino-unknown.zip')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /unexpected archive name/)
})
