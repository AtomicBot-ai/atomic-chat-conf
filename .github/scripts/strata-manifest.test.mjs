import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { checkStrataManifest, checkStrataCandidate } from './strata-manifest-check.mjs'

// Synthetic contract fixture: never published as release or candidate metadata.
export function sampleStrataManifest(platform = 'macos-arm64', backend = 'metal') {
  const os = platform.split('-')[0], arch = platform.includes('x64') ? 'x64' : 'arm64'
  const host = { os, arch, minimum_os_version: os === 'macos' ? '15.0' : '24.04', cpu_features: arch === 'x64' ? ['avx2'] : [], gpu_vendor: { metal: 'apple', hip: 'amd', sycl: 'intel', cuda12: 'nvidia', cuda13: 'nvidia' }[backend], gpu_architectures: backend === 'metal' ? ['apple-gpu'] : ['sm_86'] }
  if (backend.startsWith('cuda')) host.minimum_driver = '580.65'
  if (platform.endsWith('spark')) Object.assign(host, { device_family: 'dgx-spark', gpu_architectures: ['sm_121'] })
  const notice = { name: 'Synthetic', license: 'MIT', url: 'https://example.org/LICENSE', sha256: 'a'.repeat(64) }
  return { schema_version: 1, releases: [{ release_id: 'strata-0.1.59-r1', engine_version: '0.1.59', control_versions: ['0.1.59', '0.1.59.1'], minimum_core_version: '99.0.0', adapter_contract_version: 1, preparation_abi: 'strata-v1',
    components: ['control', 'qwen'].map(kind => ({ id: kind, kind, version: kind === 'control' ? '0.1.59.1' : '0.1.59', platform,
      ...(kind === 'control' ? { python_version: '3.12.15', python_modules: ['numpy'], structured_output: false } : { backend }),
      url: `https://example.org/strata-0.1.59-r1/${kind}.tar.gz`, sha256: 'b'.repeat(64), size: 100, unpacked_bytes: 200, executable_paths: ['bin/program'], archive: 'tar.gz', source_revision: 'c'.repeat(40), notices: [notice] })),
    variants: [{ id: platform + '-' + backend, platform, backend, host, components: ['control', 'qwen'], families: ['qwen38'], qualification: { status: 'upstream-supported', urls: ['https://example.org/evidence'] }, bundle: { url: 'https://example.org/bundle.tar.gz', sha256: 'd'.repeat(64), size: 100, unpacked_bytes: 200, archive: 'tar.gz', bundle_manifest_sha256: 'e'.repeat(64), python: platform === 'windows-x64' ? 'control/python/python.exe' : 'control/python/bin/python3', component_roots: { control: 'control', qwen: 'components/qwen' } } }],
  }] }
}
const scratch = mkdtempSync(join(tmpdir(), 'strata-manifest-'))
after(() => rmSync(scratch, { recursive: true, force: true }))
function accepts(data) {
  const path = join(scratch, 'manifest.json'); writeFileSync(path, JSON.stringify(data))
  const args = ['validate', '-s', 'backends/strata-schema.json', '-d', path, '--strict=false']
  const result = process.env.AJV_CLI
    ? spawnSync(process.execPath, [process.env.AJV_CLI, ...args], { encoding: 'utf8' })
    : spawnSync('npx', ['--yes', 'ajv-cli@5', ...args], { encoding: 'utf8' })
  assert.ifError(result.error)
  if (result.status !== 0) assert.match(result.stdout + result.stderr, /invalid/, 'The validator must launch successfully')
  return result.status === 0
}
test('strata-manifest: strict Draft-07 accepts a complete bundle and rejects missing integrity fields', () => {
  assert.equal(accepts(sampleStrataManifest()), true)
  for (const field of ['sha256', 'size', 'unpacked_bytes', 'source_revision', 'notices']) {
    const d = sampleStrataManifest(); delete d.releases[0].components[0][field]; assert.equal(accepts(d), false, field)
  }
  const d = sampleStrataManifest(); d.releases[0].command = 'anything'; assert.equal(accepts(d), false)
  const noBundle = sampleStrataManifest(); delete noBundle.releases[0].variants[0].bundle; assert.equal(accepts(noBundle), false)
  const noBundleHash = sampleStrataManifest(); delete noBundleHash.releases[0].variants[0].bundle.sha256; assert.equal(accepts(noBundleHash), false)
})
test('strata-manifest: all supported OS/backend pairs and no CPU fallback', () => {
  for (const [os, backends] of Object.entries({ 'windows-x64': ['cuda12', 'cuda13', 'hip'], 'linux-x64': ['cuda12', 'cuda13', 'hip', 'sycl'], 'macos-arm64': ['metal'], 'linux-arm64-spark': ['cuda13'] })) {
    for (const backend of backends) assert.deepEqual(checkStrataManifest(sampleStrataManifest(os, backend)), [])
  }
  for (const mutate of [v => v.backend = 'cpu', v => v.host.arch = 'x64', v => v.host.gpu_vendor = 'intel', v => v.host.minimum_os_version = '14.0', v => v.families.push('qwen36')]) {
    const d = sampleStrataManifest(); mutate(d.releases[0].variants[0]); assert.ok(checkStrataManifest(d).length)
  }
  const spark = sampleStrataManifest('linux-arm64-spark', 'cuda13'); delete spark.releases[0].variants[0].host.device_family
  assert.match(checkStrataManifest(spark).join(), /Spark/)
})
test('strata-manifest: component compatibility, complete roles and validator dependencies', () => {
  for (const mutate of [r => r.components[1].platform = 'linux-x64', r => r.components[1].version = '0.1.58', r => r.components[0].version = '0.1.1', r => r.variants[0].components.pop(), r => r.components[0].structured_output = true, r => r.components[0].executable_paths = ['../python'], r => delete r.components[1].sha256]) {
    const d = sampleStrataManifest(); mutate(d.releases[0]); assert.ok(checkStrataManifest(d).length)
  }
  const d = sampleStrataManifest('linux-x64', 'sycl'); d.releases[0].variants[0].families.push('deepseek41')
  assert.match(checkStrataManifest(d).join(), /DeepSeek/)
  const badLayout = sampleStrataManifest(); badLayout.releases[0].variants[0].bundle.python = 'system/python'
  assert.match(checkStrataManifest(badLayout).join(), /Bundle layout/)
})
test('strata-manifest: candidate family GPU restrictions must fit each selected compute', () => {
  const candidate = JSON.parse(readFileSync('backends/strata-manifest.candidate.json', 'utf8'))
  assert.deepEqual(checkStrataCandidate(candidate), [])
  candidate.variants.find(v => v.id === 'linux-x64-cuda13').host.gpu_architectures.push('sm_999')
  assert.match(checkStrataCandidate(candidate).join(), /GPU architectures/)
})
test('strata-manifest: published release ids cannot be reused with different bytes or metadata', () => {
  const base = sampleStrataManifest(), d = structuredClone(base)
  d.releases[0].components[0].size++
  assert.match(checkStrataManifest(d, base).join(), /Immutable release/)
  d.releases[0].release_id = 'strata-0.1.59-r2'
  assert.deepEqual(checkStrataManifest(d, base), [])
  d.releases.push(structuredClone(d.releases[0])); assert.match(checkStrataManifest(d).join(), /Duplicate release/)
})
