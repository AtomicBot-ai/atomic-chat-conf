import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  checkDescriptorImmutability,
  readDescriptorAtRef,
} from './runtime-descriptor-immutability.mjs'

// descriptor_id immutability (R24 / F2): a published descriptor_id's content
// must never change — core caches an accepted descriptor by this id and pins
// an installation to it, so editing a published descriptor's fields in place
// would silently change what an already-installed engine is compared
// against (see README "descriptor_id is immutable"). This compares the
// working tree's runtimes/tensorrt-llm.json against the same file read from
// a base git ref.
//
// The pure comparison (checkDescriptorImmutability) is tested in isolation
// first, against in-memory objects, with no git or disk involved. The single
// integration test at the bottom exercises the real base ref via git.

const descriptor = JSON.parse(
  readFileSync(new URL('../../runtimes/tensorrt-llm.json', import.meta.url), 'utf8')
)

const BASE_REF = process.env.RUNTIME_DESCRIPTOR_BASE_REF || 'origin/main'

test('immutability: same descriptor_id + same content -> ok', () => {
  const same = JSON.parse(JSON.stringify(descriptor))
  const result = checkDescriptorImmutability(descriptor, same)
  assert.equal(result.ok, true)
})

test('immutability: same descriptor_id + same content but reordered keys -> ok (key order is not content)', () => {
  // Canonical comparison must sort object keys recursively, so a base file
  // that merely serializes its keys in a different order is not a "changed
  // content" false positive.
  const reorderedTopLevel = {}
  for (const key of Object.keys(descriptor).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))) {
    reorderedTopLevel[key] = descriptor[key]
  }
  const result = checkDescriptorImmutability(descriptor, reorderedTopLevel)
  assert.equal(result.ok, true)
})

test('immutability: same descriptor_id + canonically different content -> fail', () => {
  const changed = { ...descriptor, download_bytes: descriptor.download_bytes + 1 }
  const result = checkDescriptorImmutability(descriptor, changed)
  assert.equal(result.ok, false)
  assert.match(result.reason, /descriptor_id "tensorrt-llm-1\.2\.1-r2"/)
  assert.match(result.reason, /new/i)
})

test('immutability: different descriptor_id -> ok even though content also differs', () => {
  const changed = {
    ...descriptor,
    descriptor_id: 'tensorrt-llm-1.2.1-r3',
    download_bytes: descriptor.download_bytes + 1,
  }
  const result = checkDescriptorImmutability(descriptor, changed)
  assert.equal(result.ok, true)
})

test('immutability: absent base descriptor -> ok', () => {
  const result = checkDescriptorImmutability(null, descriptor)
  assert.equal(result.ok, true)
})

test('readDescriptorAtRef: all-zeros ref (push "before" on a brand-new branch) is treated as absent', () => {
  assert.equal(readDescriptorAtRef('0000000000000000000000000000000000000000'), null)
})

test('readDescriptorAtRef: empty ref is treated as absent', () => {
  assert.equal(readDescriptorAtRef(''), null)
})

test('readDescriptorAtRef: a ref that does not exist in this repo is treated as absent', () => {
  assert.equal(readDescriptorAtRef('refs/this-ref-does-not-exist-xyz'), null)
})

test(`descriptor_id immutability against base ref "${BASE_REF}" (env RUNTIME_DESCRIPTOR_BASE_REF, default origin/main)`, () => {
  const base = readDescriptorAtRef(BASE_REF)
  if (base === null) {
    console.log(`  base ref/file absent at "${BASE_REF}" — nothing to compare, passing`)
    return
  }
  const result = checkDescriptorImmutability(base, descriptor)
  assert.equal(result.ok, true, result.reason)
})
