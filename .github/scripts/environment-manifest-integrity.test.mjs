import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// Cross-field integrity for runtimes/environments/linux.json that the JSON
// Schema cannot express. Each check is a pure function over an in-memory
// manifest object, so it is testable against a deliberately broken clone
// without touching disk (see environment-manifest.test.mjs for the
// schema-shape half of this gate).

const MANIFEST_PATH = new URL('../../runtimes/environments/linux.json', import.meta.url)
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
const clone = (value) => JSON.parse(JSON.stringify(value))

function checkUniqueRecipeIds(m) {
  const errors = []
  const seen = new Set()
  for (const r of m.recipes ?? []) {
    if (seen.has(r.recipe_id)) errors.push(`recipes: duplicate recipe_id "${r.recipe_id}"`)
    seen.add(r.recipe_id)
  }
  return errors
}

function checkUniqueDistributionsPerRecipe(m) {
  const errors = []
  for (const r of m.recipes ?? []) {
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

// The schema pins the Linux pattern already; this check states the rule for
// every platform's manifest (<platform>-r<N>), so a manifest copied to start
// another platform's file cannot keep the wrong prefix.
function checkManifestIdPrefix(m) {
  const errors = []
  const prefix = `${m.platform}-`
  if (typeof m.manifest_id !== 'string' || !m.manifest_id.startsWith(prefix)) {
    errors.push(`manifest_id "${m.manifest_id}" must start with "${prefix}" (platform + "-")`)
  }
  return errors
}

const CHECKS = [checkUniqueRecipeIds, checkUniqueDistributionsPerRecipe, checkManifestIdPrefix]

function checkManifestIntegrity(m) {
  return CHECKS.flatMap((check) => check(m))
}

test('the committed linux.json environment manifest passes every integrity check', () => {
  assert.deepEqual(checkManifestIntegrity(manifest), [])
})

test('the valid.json fixture passes every integrity check', () => {
  const fixturePath = new URL('../fixtures/runtimes/environments/valid.json', import.meta.url)
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
  assert.deepEqual(checkManifestIntegrity(fixture), [])
})

test('rejects: duplicate recipe_id', () => {
  const bad = clone(manifest)
  bad.recipes.push({ ...bad.recipes[0] })
  const errors = checkUniqueRecipeIds(bad)
  assert.equal(errors.length, 1)
  assert.match(errors[0], new RegExp(bad.recipes[0].recipe_id))
})

test('rejects: duplicate (id, version_id, arch) distribution within one recipe', () => {
  const bad = clone(manifest)
  bad.recipes[0].distributions.push({ ...bad.recipes[0].distributions[0] })
  const errors = checkUniqueDistributionsPerRecipe(bad)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /duplicate/i)
})

test('accepts: the same distribution in two different recipes', () => {
  const ok = clone(manifest)
  ok.recipes.push({ recipe_id: 'linux.another-recipe', distributions: [ok.recipes[0].distributions[0]] })
  assert.deepEqual(checkUniqueDistributionsPerRecipe(ok), [])
})

test('rejects: manifest_id not prefixed with platform + "-"', () => {
  const bad = clone(manifest)
  bad.manifest_id = 'windows-r1'
  const errors = checkManifestIdPrefix(bad)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /manifest_id/)
})
