import assert from 'node:assert/strict'
import { test } from 'node:test'
import { legacyManifest, selectAssets } from './mirror.mjs'

// The asset names ggml-org published for b12244 (cudart companions left out:
// they are never selected, only referenced by legacyManifest).
const B12244 = [
  'llama-b12244-bin-android-arm64-snapdragon.tar.gz',
  'llama-b12244-bin-android-arm64.tar.gz',
  'llama-b12244-bin-linux-arm64-snapdragon.tar.gz',
  'llama-b12244-bin-macos-arm64.tar.gz',
  'llama-b12244-bin-macos-x64.tar.gz',
  'llama-b12244-bin-ubuntu-26.04-s390x.tar.gz',
  'llama-b12244-bin-ubuntu-arm64.tar.gz',
  'llama-b12244-bin-ubuntu-cuda-12.8-x64.tar.gz',
  'llama-b12244-bin-ubuntu-cuda-13.5-arm64.tar.gz',
  'llama-b12244-bin-ubuntu-cuda-13.5-x64.tar.gz',
  'llama-b12244-bin-ubuntu-openvino-2026.4.1-x64.tar.gz',
  'llama-b12244-bin-ubuntu-rocm-10.0-x64.tar.gz',
  'llama-b12244-bin-ubuntu-s390x.tar.gz',
  'llama-b12244-bin-ubuntu-sycl-fp16-x64.tar.gz',
  'llama-b12244-bin-ubuntu-sycl-fp32-x64.tar.gz',
  'llama-b12244-bin-ubuntu-vulkan-arm64.tar.gz',
  'llama-b12244-bin-ubuntu-vulkan-x64.tar.gz',
  'llama-b12244-bin-ubuntu-x64.tar.gz',
  'llama-b12244-bin-ubuntu-zdnn-s390x.tar.gz',
  'llama-b12244-bin-win-cpu-arm64.zip',
  'llama-b12244-bin-win-cpu-x64.zip',
  'llama-b12244-bin-win-cuda-12.4-x64.zip',
  'llama-b12244-bin-win-cuda-13.5-arm64.zip',
  'llama-b12244-bin-win-cuda-13.5-x64.zip',
  'llama-b12244-bin-win-opencl-adreno-arm64.zip',
  'llama-b12244-bin-win-openvino-2026.4.1-x64.zip',
  'llama-b12244-bin-win-rocm-10.0-x64.zip',
  'llama-b12244-bin-win-sycl-x64.zip',
  'llama-b12244-bin-win-vulkan-arm64.zip',
  'llama-b12244-bin-win-vulkan-x64.zip',
  'llama-b12244-ui.tar.gz',
  'llama-b12244-xcframework.zip',
]

const assets = (names) => names.map((name) => ({ name, size: 1 }))
const names = (selected) => selected.map((a) => a.name)

test('b12244: mirrors the desktop matrix, Linux x64 CUDA and Windows ARM Vulkan included', () => {
  const selected = selectAssets('b12244', assets(B12244))
  assert.deepEqual(names(selected), [
    'llama-b12244-bin-macos-arm64.tar.gz',
    'llama-b12244-bin-ubuntu-arm64.tar.gz',
    'llama-b12244-bin-ubuntu-cuda-12.8-x64.tar.gz',
    'llama-b12244-bin-ubuntu-cuda-13.5-arm64.tar.gz',
    'llama-b12244-bin-ubuntu-cuda-13.5-x64.tar.gz',
    'llama-b12244-bin-ubuntu-rocm-10.0-x64.tar.gz',
    'llama-b12244-bin-ubuntu-vulkan-arm64.tar.gz',
    'llama-b12244-bin-ubuntu-vulkan-x64.tar.gz',
    'llama-b12244-bin-ubuntu-x64.tar.gz',
    'llama-b12244-bin-win-cpu-arm64.zip',
    'llama-b12244-bin-win-cpu-x64.zip',
    'llama-b12244-bin-win-cuda-12.4-x64.zip',
    'llama-b12244-bin-win-cuda-13.5-arm64.zip',
    'llama-b12244-bin-win-cuda-13.5-x64.zip',
    'llama-b12244-bin-win-opencl-adreno-arm64.zip',
    'llama-b12244-bin-win-rocm-10.0-x64.zip',
    'llama-b12244-bin-win-vulkan-arm64.zip',
    'llama-b12244-bin-win-vulkan-x64.zip',
  ])
  const platformOf = Object.fromEntries(selected.map((a) => [a.name, a.platform]))
  assert.equal(platformOf['llama-b12244-bin-win-vulkan-arm64.zip'], 'windows')
  assert.equal(platformOf['llama-b12244-bin-ubuntu-cuda-12.8-x64.tar.gz'], 'linux')
  assert.equal(
    selected[0].url,
    'https://github.com/ggml-org/llama.cpp/releases/download/b12244/llama-b12244-bin-macos-arm64.tar.gz'
  )
})

test('a ROCm version bump upstream is still mirrored on Linux and Windows', () => {
  const bumped = B12244.map((n) => n.replace('rocm-10.0', 'rocm-10.1'))
  const selected = names(selectAssets('b12244', assets(bumped)))
  assert.ok(selected.includes('llama-b12244-bin-ubuntu-rocm-10.1-x64.tar.gz'))
  assert.ok(selected.includes('llama-b12244-bin-win-rocm-10.1-x64.zip'))
})

test('an older tag without the new variants still mirrors', () => {
  const older = B12244.filter(
    (n) => !/ubuntu-cuda-[\d.]+-x64|win-vulkan-arm64|rocm/.test(n)
  ).map((n) => n.replace('b12244', 'b11463'))
  const selected = names(selectAssets('b11463', assets(older)))
  assert.equal(selected.length, 13)
  assert.ok(!selected.some((n) => /rocm|vulkan-arm64\.zip|cuda-[\d.]+-x64\.tar/.test(n)))
})

test('a tag missing a required archive is refused', () => {
  const broken = B12244.filter((n) => !n.endsWith('win-cpu-x64.zip'))
  assert.throws(() => selectAssets('b12244', assets(broken)), /missing required assets/)
})

test('the legacy manifest references the Linux x64 CUDA runtime companions', () => {
  const archives = selectAssets('b12244', assets(B12244)).map(({ name }) => ({ name, sha256: '0'.repeat(64) }))
  const manifest = legacyManifest('b12244', archives, 'https://example.invalid', '2026-11-10T00:00:00Z')
  const companions = manifest.assets.filter((a) => a.name.startsWith('cudart-')).map((a) => a.name)
  assert.deepEqual(companions, [
    'cudart-llama-b12244-bin-ubuntu-cuda-12.8-x64.tar.gz',
    'cudart-llama-b12244-bin-ubuntu-cuda-13.5-arm64.tar.gz',
    'cudart-llama-b12244-bin-ubuntu-cuda-13.5-x64.tar.gz',
    'cudart-llama-bin-win-cuda-12.4-x64.zip',
    'cudart-llama-bin-win-cuda-13.5-arm64.zip',
    'cudart-llama-bin-win-cuda-13.5-x64.zip',
  ])
})
