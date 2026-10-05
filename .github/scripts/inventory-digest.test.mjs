import assert from 'node:assert/strict'
import { test } from 'node:test'
import { filesFromHfSiblings, inventoryDigest } from './inventory-digest.mjs'

// The expected digests below were produced by running atomic-chat-core's own
// `inventoryDigest` (origin/feat/tenzor-rt 632b9344, src/models/snapshot-plan.ts)
// under Node's TypeScript stripping — not by this port. core compares a curated
// entry's inventory_digest against what it computes itself, so any drift here
// means a curated model that never matches.
const coreTestFiles = [
  { path: 'config.json', bytes: 1_024 },
  { path: 'model-00001-of-00002.safetensors', bytes: 4_250_000_000, sha256: 'aa' },
  { path: 'model-00002-of-00002.safetensors', bytes: 4_250_000_000, sha256: 'bb' },
  { path: 'tokenizer.json', bytes: 17_000 },
]

test("matches core's digest for core's own test inventory", () => {
  assert.equal(
    inventoryDigest(coreTestFiles),
    'sha256:8e362dc849296c338a83624998d58303ad62cf2ed7f47216b9a1746daf59824c'
  )
})

test('ignores listing order', () => {
  assert.equal(inventoryDigest([...coreTestFiles].reverse()), inventoryDigest(coreTestFiles))
})

test("length-prefixes paths exactly like core (a+bc vs ab+c)", () => {
  assert.equal(
    inventoryDigest([{ path: 'a', bytes: 1 }, { path: 'bc', bytes: 1 }]),
    'sha256:0f8574ffdacd2579a64fb1fa155e46de6ae3055e2abaa6be3c17696949d4df67'
  )
  assert.equal(
    inventoryDigest([{ path: 'ab', bytes: 1 }, { path: 'c', bytes: 1 }]),
    'sha256:cd97260fab6815624d1f488cbebb2ef690e38df6ae25a6f73412417660982e57'
  )
})

test('sorts by UTF-16 code unit and prefixes the UTF-16 length, like core', () => {
  assert.equal(
    inventoryDigest([
      { path: 'b/é.txt', bytes: 3 },
      { path: 'B.txt', bytes: 0, sha256: '' },
      { path: 'a', bytes: 0 },
    ]),
    'sha256:1cf7709515b01e406d41ea1a338462764da44bbdde916f5d58e911b7b7edf2ab'
  )
})

test('rejects what core rejects', () => {
  assert.throws(() => inventoryDigest([]))
  assert.throws(() => inventoryDigest([{ path: '', bytes: 1 }]))
  assert.throws(() => inventoryDigest([{ path: 'a', bytes: -1 }]))
  assert.throws(() => inventoryDigest([{ path: 'a', bytes: 1.5 }]))
  assert.throws(() => inventoryDigest([{ path: 'a', bytes: 1 }, { path: 'a', bytes: 1 }]))
  assert.throws(() => inventoryDigest([{ path: 'a\u0000b', bytes: 1 }]))
})

test('maps Hugging Face siblings the way core does (lfs size/sha256 first, every file kept)', () => {
  const siblings = [
    { rfilename: 'config.json', size: 1024, blobId: 'x' },
    {
      rfilename: 'model.safetensors',
      size: 999,
      lfs: { size: 4_250_000_000, sha256: 'aa', pointerSize: 135 },
    },
    { rfilename: 'README.md' },
  ]
  assert.deepEqual(filesFromHfSiblings(siblings), [
    { path: 'config.json', bytes: 1024 },
    { path: 'model.safetensors', bytes: 4_250_000_000, sha256: 'aa' },
    { path: 'README.md', bytes: 0 },
  ])
})
