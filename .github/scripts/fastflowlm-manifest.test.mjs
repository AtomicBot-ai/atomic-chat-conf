import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { checkBuilds, checkEnvironment, compareBuilds, BUILD_PATH, ENVIRONMENT_PATHS } from './fastflowlm-manifest-check.mjs'

const read = path => JSON.parse(readFileSync(path, 'utf8'))
const scratch = mkdtempSync(join(tmpdir(), 'flm-contract-'))
after(() => rmSync(scratch, { recursive: true, force: true }))
// Synthetic contract data only. These hashes never enter production or candidate data.
const sha = 'a'.repeat(64), commit = 'b'.repeat(40)
const blob = name => ({ url: `https://github.com/AtomicBot-ai/atomic-chat-core/releases/download/flm-1.0.11-r1/${name}`, size: 1, sha256: sha })
export const sampleBuilds = () => ({ schema_version: 1, releases: [{
  version: 'flm-1.0.11-r1', upstream_commit: commit, atomic_revision: 1,
  local_only_protocol: 1, min_core_version: '0.20.6', published_at: '2026-11-04T00:00:00Z',
  provenance: { core_commit: commit, patch_sha256: sha, dependencies_sha256: sha, document: blob('provenance.json') },
  assets: ['win-x64-npu', 'linux-x64-npu'].map(platform => ({ platform, ...blob(`${platform}.zip`) })),
}] })
const environment = os => ({
  schema_version: 1, engine: 'fastflowlm', platform: os, manifest_id: `fastflowlm-${os}-r1`,
  recipes: [{ recipe_id: `fastflowlm-${os}-test`, action: `${os}.install-amd-npu`, revision: 1, min_core_version: '0.20.6',
    hardware: { npu_generation: 'xdna2', pci_device_ids: ['1022:17f0'] },
    qualification: { evidence: blob('live-evidence.json'), build_version: 'flm-1.0.11-r1' },
    ...(os === 'windows' ? {
      platforms: [{ os: 'windows', version: '11', arch: 'x64' }],
      driver: { kind: 'amd-installer', version: '32.0.203.314', url: 'https://download.amd.com/test-only.zip', size: 1, sha256: sha, signer: 'Microsoft Windows Hardware Compatibility Publisher', catalog_sha256: sha },
    } : {
      platforms: [{ os: 'linux', distribution: 'ubuntu', version: '24.04', arch: 'x64', kernel_release: '6.17.0-1-generic' }],
      sources: [{ id: 'lemonade', url: 'https://ppa.launchpadcontent.net/lemonade-team/stable/ubuntu/', suite: 'noble', component: 'main', signing_fingerprint: 'B'.repeat(40) }],
      packages: [{ name: 'libxrt-npu2', version: '1:2.25.0-4~noble1', architecture: 'amd64', source: 'lemonade', path: 'pool/main/x/xrt/test.deb', size: 1, sha256: sha }],
      firmware_version: '1.1.0.0', xrt: 'system', memlock_bytes: 4294967296,
    }),
  }],
})

function schemaAccepts(schema, data) {
  const path = join(scratch, 'document.json')
  writeFileSync(path, JSON.stringify(data))
  const result = spawnSync('npx', ['--yes', 'ajv-cli@5', 'validate', '-s', schema, '-d', path, '--strict=false'], { encoding: 'utf8' })
  assert.ifError(result.error)
  if (result.status !== 0) assert.match(result.stdout + result.stderr, /invalid/, 'Validator must reject data, not fail to launch')
  return result.status === 0
}

for (const [path, schema, sample, check] of [
  [BUILD_PATH, 'backends/fastflowlm-schema.json', sampleBuilds, checkBuilds],
  ...['windows', 'linux'].map(os => [ENVIRONMENT_PATHS.find(p => p.includes(os)), `runtimes/environments/fastflowlm-${os}.schema.json`, () => environment(os), checkEnvironment]),
]) {
  test(`${path}: empty production and populated synthetic fixture satisfy schema`, () => {
    assert.equal(schemaAccepts(schema, read(path)), true)
    assert.equal(schemaAccepts(schema, sample()), true)
    assert.deepEqual(check(sample()), [])
  })
  test(`${path}: arbitrary commands and unknown fields rejected at both levels`, () => {
    for (const field of ['command', 'future_field']) {
      const data = sample(); data[field] = 'anything'
      assert.equal(schemaAccepts(schema, data), false)
      delete data[field]; (data.releases ?? data.recipes)[0][field] = 'anything'
      assert.equal(schemaAccepts(schema, data), false)
    }
  })
}
test('build schema rejects missing hash, unsupported protocol, foreign URL and unknown platform', () => {
  for (const mutate of [r => delete r.assets[0].sha256, r => r.local_only_protocol = 2, r => r.assets[0].url = 'https://example.org/flm.zip', r => r.assets[0].platform = 'mac-arm64']) {
    const data = sampleBuilds(); mutate(data.releases[0])
    assert.equal(schemaAccepts('backends/fastflowlm-schema.json', data), false)
  }
})
test('duplicate build/platform, mismatched revision and tag are rejected', () => {
  for (const mutate of [d => d.releases.push(structuredClone(d.releases[0])), d => d.releases[0].assets[1] = d.releases[0].assets[0], d => d.releases[0].atomic_revision = 2, d => d.releases[0].assets[0].url = blob('x').url.replace('-r1/', '-r2/')]) {
    const data = sampleBuilds(); mutate(data); assert.ok(checkBuilds(data).length)
  }
})
test('build comparison is numeric, including Atomic revision; published builds are immutable', () => {
  assert.equal(compareBuilds('flm-1.0.11-r10', 'flm-1.0.11-r2'), 1)
  assert.equal(compareBuilds('flm-1.0.9-r10', 'flm-1.0.11-r1'), -1)
  const base = sampleBuilds(), current = structuredClone(base)
  current.releases[0].assets[0].size++
  assert.match(checkBuilds(current, base).join(), /Immutable build/)
  assert.deepEqual(checkBuilds(base, structuredClone(base)), [])
  const newer = structuredClone(base.releases[0])
  newer.version = 'flm-1.0.11-r2'; newer.atomic_revision = 2
  for (const asset of [...newer.assets, newer.provenance.document]) asset.url = asset.url.replace('-r1/', '-r2/')
  assert.deepEqual(checkBuilds({ schema_version: 1, releases: [newer, ...base.releases] }), [])
  assert.match(checkBuilds({ schema_version: 1, releases: [...base.releases, newer] }).join(), /newest first/)
  newer.published_at = 'not-a-date'
  assert.match(checkBuilds({ schema_version: 1, releases: [newer] }).join(), /timestamp/)
})
test('environment and recipe IDs cannot be reused with changed contents', () => {
  for (const os of ['windows', 'linux']) {
    const base = environment(os), current = structuredClone(base)
    current.recipes[0].min_core_version = '0.21.0'
    assert.match(checkEnvironment(current, base).join(), /manifest_id.*immutable/)
    current.manifest_id = `fastflowlm-${os}-r2`
    assert.match(checkEnvironment(current, base).join(), /Immutable recipe/)
    current.recipes[0].revision++
    assert.deepEqual(checkEnvironment(current, base), [])
  }
})
test('environment integrity rejects cross-distro packages, missing sources and ambiguous platform', () => {
  for (const mutate of [r => r.sources[0].suite = 'resolute', r => r.packages[0].source = 'missing', r => r.packages[0].path = 'pool/../evil.deb', r => r.platforms.push(r.platforms[0])]) {
    const data = environment('linux'); mutate(data.recipes[0]); assert.ok(checkEnvironment(data).length)
  }
  const windows = environment('windows')
  windows.recipes[0].driver.kind = 'windows-update-cab'
  assert.match(checkEnvironment(windows).join(), /package kind/)
})
