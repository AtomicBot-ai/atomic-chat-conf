import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// Cross-field integrity for runtimes/tensorrt-llm.json that the JSON Schema
// cannot express (schema.json can only constrain one field/subtree at a
// time). Each check is a pure function over an in-memory descriptor object,
// so it is testable against a deliberately broken clone without touching
// disk — and so `make validate` and CI can both run the same node:test file
// (see runtime-descriptor.test.mjs for the schema-shape half of this gate).

const DESCRIPTOR_PATH = new URL('../../runtimes/tensorrt-llm.json', import.meta.url)
const descriptor = JSON.parse(readFileSync(DESCRIPTOR_PATH, 'utf8'))
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

function checkUniqueRecipeIds(d) {
  const errors = []
  const seen = new Set()
  for (const r of d.recipes ?? []) {
    if (seen.has(r.recipe_id)) errors.push(`recipes: duplicate recipe_id "${r.recipe_id}"`)
    seen.add(r.recipe_id)
  }
  return errors
}

function checkUniqueDistributionsPerRecipe(d) {
  const errors = []
  for (const r of d.recipes ?? []) {
    const seen = new Set()
    for (const dist of r.distributions ?? []) {
      const key = `${dist.id}/${dist.version_id}/${dist.arch}`
      if (seen.has(key)) {
        errors.push(`recipe "${r.recipe_id}": duplicate distribution (id, version_id, arch) "${key}"`)
      }
      seen.add(key)
    }
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
  checkUniqueRecipeIds,
  checkUniqueDistributionsPerRecipe,
  checkDescriptorIdPrefix,
  checkRequiredDiskAtLeastDownload,
  checkMinimumComputeCapabilityIsAFloor,
  checkExcludedComputeCapabilitiesAboveMinimum,
]

function checkDescriptorIntegrity(d) {
  return CHECKS.flatMap((check) => check(d))
}

test('the committed tensorrt-llm.json descriptor passes every integrity check', () => {
  assert.deepEqual(checkDescriptorIntegrity(descriptor), [])
})

test('the valid.json fixture passes every integrity check', () => {
  const fixturePath = new URL('../fixtures/runtimes/valid.json', import.meta.url)
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
  assert.deepEqual(checkDescriptorIntegrity(fixture), [])
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

test('rejects: duplicate recipe_id', () => {
  const bad = clone(descriptor)
  bad.recipes.push({ ...bad.recipes[0] })
  const errors = checkUniqueRecipeIds(bad)
  assert.equal(errors.length, 1)
  assert.match(errors[0], new RegExp(bad.recipes[0].recipe_id))
})

test('rejects: duplicate (id, version_id, arch) distribution within one recipe', () => {
  const bad = clone(descriptor)
  bad.recipes[0].distributions.push({ ...bad.recipes[0].distributions[0] })
  const errors = checkUniqueDistributionsPerRecipe(bad)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /duplicate/i)
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
  const fixturePath = new URL(
    '../fixtures/runtimes/invalid-excluded-cc-below-minimum.json',
    import.meta.url
  )
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
  const errors = checkDescriptorIntegrity(fixture)
  assert.equal(errors.length, 1)
  assert.equal(
    errors[0],
    'quantization "fp8": excluded_compute_capabilities entry (8.0) must be strictly greater than its own min_compute_capability (8.9)'
  )
})
