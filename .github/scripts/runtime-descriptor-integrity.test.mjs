import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { REPO_ROOT, engineIdFromPath, listDescriptorPaths } from './runtime-descriptor-files.mjs'

// Cross-field integrity for every runtimes/<engine_id>.json that the JSON Schema
// cannot express (schema.json can only constrain one field/subtree at a
// time). Each check is a pure function over an in-memory descriptor object,
// so it is testable against a deliberately broken clone without touching
// disk — and so `make validate` and CI can both run the same node:test file
// (see runtime-descriptor.test.mjs for the schema-shape half of this gate).
// Descriptors are discovered, not named (runtime-descriptor-files.mjs).

const readJson = (path) => JSON.parse(readFileSync(join(REPO_ROOT, path), 'utf8'))
// The rejection tests below break a clone of the TensorRT-LLM descriptor: it is
// the one whose formats (fp8, its 8.0 floor) the assertions name.
const descriptor = readJson('runtimes/tensorrt-llm.json')
const clone = (value) => JSON.parse(JSON.stringify(value))

function checkUniqueSupportedArchitectures(d) {
  const errors = []
  const seen = new Set()
  for (const arch of d.supported_architectures ?? []) {
    if (seen.has(arch)) errors.push(`supported_architectures: duplicate entry "${arch}"`)
    seen.add(arch)
  }
  return errors
}

function checkModelFamiliesSubsetOfSupportedArchitectures(d) {
  const errors = []
  const archs = new Set(d.supported_architectures ?? [])
  for (const key of Object.keys(d.model_families ?? {})) {
    if (!archs.has(key)) {
      errors.push(`model_families: key "${key}" is not in supported_architectures`)
    }
  }
  return errors
}

function checkUniqueQuantizationFormats(d) {
  const errors = []
  const seen = new Set()
  for (const q of d.quantization ?? []) {
    if (seen.has(q.format)) errors.push(`quantization: duplicate format "${q.format}"`)
    seen.add(q.format)
  }
  return errors
}

function checkUniqueCuratedModels(d) {
  const errors = []
  const seen = new Set()
  for (const m of d.curated_models ?? []) {
    const key = `${m.repository}@${m.revision}`
    if (seen.has(key)) errors.push(`curated_models: duplicate repository@revision "${key}"`)
    seen.add(key)
  }
  return errors
}

function checkDescriptorIdPrefix(d) {
  const errors = []
  const prefix = `${d.engine_id}-`
  if (typeof d.descriptor_id !== 'string' || !d.descriptor_id.startsWith(prefix)) {
    errors.push(`descriptor_id "${d.descriptor_id}" must start with "${prefix}" (engine_id + "-")`)
  }
  return errors
}

function checkRequiredDiskAtLeastDownload(d) {
  const errors = []
  if (!(d.required_disk_bytes >= d.download_bytes)) {
    errors.push(
      `required_disk_bytes (${d.required_disk_bytes}) must be >= download_bytes (${d.download_bytes})`
    )
  }
  return errors
}

// "major.minor" compare, e.g. "8.0" <= "8.9" <= "9.0" <= "10.0" (numeric, not
// lexicographic — "10.0" must sort after "9.0").
const parseComputeCapability = (value) => value.split('.').map(Number)
const computeCapabilityAtMost = (a, b) => {
  const [aMajor, aMinor] = parseComputeCapability(a)
  const [bMajor, bMinor] = parseComputeCapability(b)
  return aMajor < bMajor || (aMajor === bMajor && aMinor <= bMinor)
}

function checkMinimumComputeCapabilityIsAFloor(d) {
  const errors = []
  for (const q of d.quantization ?? []) {
    if (!computeCapabilityAtMost(d.minimum_compute_capability, q.min_compute_capability)) {
      errors.push(
        `minimum_compute_capability (${d.minimum_compute_capability}) must be <= quantization ` +
          `"${q.format}"'s min_compute_capability (${q.min_compute_capability})`
      )
    }
  }
  return errors
}

// D17 / R30: a format's excluded_compute_capabilities lists compute capabilities where the
// engine's hardware support matrix does NOT support that format even though the capability is
// numerically above the format's own min_compute_capability (the matrix is not monotone in CC).
// An excluded entry at or below the minimum is nonsensical: that capability is already refused by
// the minimum-CC check, so listing it as an "exclusion above the minimum" is a data-entry error the
// schema itself cannot catch (it has no cross-field awareness of a sibling property).
function checkExcludedComputeCapabilitiesAboveMinimum(d) {
  const errors = []
  for (const q of d.quantization ?? []) {
    for (const excluded of q.excluded_compute_capabilities ?? []) {
      if (computeCapabilityAtMost(excluded, q.min_compute_capability)) {
        errors.push(
          `quantization "${q.format}": excluded_compute_capabilities entry (${excluded}) must be ` +
            `strictly greater than its own min_compute_capability (${q.min_compute_capability})`
        )
      }
    }
  }
  return errors
}

const CHECKS = [
  checkUniqueSupportedArchitectures,
  checkModelFamiliesSubsetOfSupportedArchitectures,
  checkUniqueQuantizationFormats,
  checkUniqueCuratedModels,
  checkDescriptorIdPrefix,
  checkRequiredDiskAtLeastDownload,
  checkMinimumComputeCapabilityIsAFloor,
  checkExcludedComputeCapabilitiesAboveMinimum,
]

function checkDescriptorIntegrity(d) {
  return CHECKS.flatMap((check) => check(d))
}

// The file name is the engine's identity in conf: core fetches runtimes/<engine_id>.json for the
// engine it has an adapter for and refuses a descriptor whose engine_id is another engine's. A
// mismatch here would publish a descriptor that every core rejects, so it fails the gate instead.
// Kept out of CHECKS because it needs the path, and fixtures are not named after an engine.
function checkEngineIdMatchesFileName(d, path) {
  const expected = engineIdFromPath(path)
  if (d.engine_id === expected) return []
  return [`${path}: engine_id "${d.engine_id}" must equal the file name "${expected}"`]
}

const checkDescriptorFile = (path) => {
  const d = readJson(path)
  return [...checkEngineIdMatchesFileName(d, path), ...checkDescriptorIntegrity(d)]
}

for (const path of listDescriptorPaths()) {
  test(`${path} passes every integrity check`, () => {
    assert.deepEqual(checkDescriptorFile(path), [])
  })
}

for (const fixture of ['valid.json', 'valid-vllm.json']) {
  test(`the ${fixture} fixture passes every integrity check`, () => {
    assert.deepEqual(checkDescriptorIntegrity(readJson(`.github/fixtures/runtimes/${fixture}`)), [])
  })
}

// "Имя файла не совпадает с движком": runtimes/vllm.json carrying engine_id tensorrt-llm. The
// fixture is otherwise valid (its descriptor_id even matches its engine_id), so the file-name rule
// is the only one that can catch it.
test('rejects: a vllm.json whose engine_id is tensorrt-llm', () => {
  const [path] = listDescriptorPaths('.github/fixtures/runtimes/catalogs/engine-id-mismatch')
  assert.deepEqual(checkDescriptorFile(path), [
    '.github/fixtures/runtimes/catalogs/engine-id-mismatch/vllm.json: engine_id "tensorrt-llm" must equal the file name "vllm"',
  ])
})

test('rejects: duplicate supported_architectures entry', () => {
  const bad = clone(descriptor)
  bad.supported_architectures.push(bad.supported_architectures[0])
  const errors = checkUniqueSupportedArchitectures(bad)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /duplicate/i)
})

test('rejects: model_families key not present in supported_architectures', () => {
  const bad = clone(descriptor)
  bad.model_families.SomeUnlistedArchForCausalLM = {
    tool_parser: null,
    reasoning_parser: null,
    structured_output: true,
  }
  const errors = checkModelFamiliesSubsetOfSupportedArchitectures(bad)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /SomeUnlistedArchForCausalLM/)
})

test('rejects: duplicate quantization format', () => {
  const bad = clone(descriptor)
  bad.quantization.push({ ...bad.quantization[0] })
  const errors = checkUniqueQuantizationFormats(bad)
  assert.equal(errors.length, 1)
  assert.match(errors[0], new RegExp(bad.quantization[0].format))
})

test('rejects: duplicate curated_models repository@revision', () => {
  const bad = clone(descriptor)
  bad.curated_models.push({ ...bad.curated_models[0] })
  const errors = checkUniqueCuratedModels(bad)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /repository@revision|@/)
})

test('rejects: descriptor_id not prefixed with engine_id + "-"', () => {
  const bad = clone(descriptor)
  bad.descriptor_id = 'not-the-engine-id-r1'
  const errors = checkDescriptorIdPrefix(bad)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /descriptor_id/)
})

test('rejects: required_disk_bytes smaller than download_bytes', () => {
  const bad = clone(descriptor)
  bad.required_disk_bytes = bad.download_bytes - 1
  const errors = checkRequiredDiskAtLeastDownload(bad)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /required_disk_bytes/)
})

test('rejects: minimum_compute_capability above a quantization entry\'s min_compute_capability', () => {
  const bad = clone(descriptor)
  // The lowest min_compute_capability among quantization entries is 8.0
  // (bf16/fp16/w4a16_awq); raising the descriptor floor above it must fail.
  bad.minimum_compute_capability = '8.1'
  const errors = checkMinimumComputeCapabilityIsAFloor(bad)
  assert.ok(errors.length >= 1)
  assert.match(errors[0], /minimum_compute_capability/)
})

test('rejects: excluded_compute_capabilities entry at or below its own min_compute_capability', () => {
  const bad = clone(descriptor)
  // fp8's min_compute_capability is 8.9; excluding 8.0 (below it) is nonsensical, and
  // excluding 8.9 itself (the boundary) is equally nonsensical ("above the minimum" means
  // strictly above).
  const fp8 = bad.quantization.find((q) => q.format === 'fp8')
  fp8.excluded_compute_capabilities = ['8.0']
  let errors = checkExcludedComputeCapabilitiesAboveMinimum(bad)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /fp8/)

  fp8.excluded_compute_capabilities = ['8.9']
  errors = checkExcludedComputeCapabilitiesAboveMinimum(bad)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /fp8/)
})

test('rejects: fixture invalid-excluded-cc-below-minimum.json (schema-valid, only the integrity check catches it)', () => {
  // This fixture is deliberately NOT in runtime-descriptor.test.mjs's ajv-rejection list: the
  // schema has no cross-field awareness, so ajv accepts it. Proving it is still rejected means
  // running the real integrity check against it directly.
  const fixture = readJson('.github/fixtures/runtimes/invalid-excluded-cc-below-minimum.json')
  const errors = checkDescriptorIntegrity(fixture)
  assert.equal(errors.length, 1)
  assert.equal(
    errors[0],
    'quantization "fp8": excluded_compute_capabilities entry (8.0) must be strictly greater than its own min_compute_capability (8.9)'
  )
})
