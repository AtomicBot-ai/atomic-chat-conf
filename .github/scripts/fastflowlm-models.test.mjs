import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { get } from 'node:https'
import { once } from 'node:events'
import { pathToFileURL } from 'node:url'
import { parseAtomicModelCatalog, projectAtomicModelCollection } from '../fixtures/fastflowlm/legacy-model-catalog.ts'
import { validateFastflowlm, projectFastflowlm } from './fastflowlm-models.mjs'
import { validateCatalog, COLLECTION_FIELDS, projectCollection } from './model-catalog.mjs'
import { consumerCatalog, writeConsumerFixtures, fixtureRoot } from './fastflowlm-fixtures.mjs'
import { fixtureServer, fixtureNames } from './fastflowlm-fixture-server.mjs'
import { refreshCatalogSource } from './refresh-model-catalog.mjs'

const read = path => JSON.parse(readFileSync(path, 'utf8'))
const candidate = () => read(new URL('model-candidate.json', fixtureRoot))
const scratch = mkdtempSync(join(tmpdir(), 'flm-models-'))
after(() => rmSync(scratch, { recursive: true, force: true }))
const allow = { allowCandidates: true }
const chatCheckpoints = [
  'gemma4-it:12b', 'lfm2.5-tk:1.2b', 'lfm3:1.7b', 'minicpm-v-4.7:1b',
  'nemotron3.5-bolt:e4b', 'qwen3.5:0.8b', 'qwen3.5:2b', 'qwen3.6-moe:35b-a3b', 'qwen3.8-mtp:27b',
]

test('chat staging offers the selected checkpoints with their own kernels, templates and weights', () => {
  const catalog = consumerCatalog('chat')
  const models = projectFastflowlm(catalog, allow).models
  assert.deepEqual(models.map(d => d.checkpoint).sort(), chatCheckpoints)
  for (const model of models) {
    assert.equal(model.qualification.status, 'candidate')
    const repo = model.sources.find(s => s.id === 'flm').repo.split('/')[1]
    const kernelSource = model.sources.find(s => s.id === 'flm-kernels')
    assert.equal(kernelSource.revision, 'f37cdd29edc777cf3db1e385da8e7bfadc57d0b3')
    assert.ok(model.components.kernels.length > 0)
    for (const name of model.components.kernels) {
      const file = model.files.find(f => f.path === name)
      assert.equal(file.source, kernelSource.id)
      assert.equal(file.source_path, `src/xclbins/${repo}/${name}`)
    }
    assert.deepEqual(model.components.chat_template, ['chat_template.jinja'])
    assert.ok(model.components.weights.includes('model.q4nx'))
  }
  assert.throws(() => validateCatalog(catalog), /unqualified candidate/)
})

test('real candidate includes every upstream-required file, kernels, embedded chat template and license', () => {
  const entry = candidate(), d = entry.definition
  assert.equal(validateFastflowlm(entry, allow), entry)
  const upstream = read(new URL('evidence/upstream-model.json', fixtureRoot))
  for (const name of upstream.definition.files) assert.ok(d.files.some(f => f.source_path === name))
  const metadata = read(new URL('evidence/hf-model-metadata.json', fixtureRoot))
  assert.equal(d.sources[0].revision, metadata.sha)
  assert.deepEqual(d.components.kernels.sort(), metadata.siblings.filter(f => f.rfilename.endsWith('.xclbin')).map(f => f.rfilename).sort())
  for (const file of d.files) {
    const source = d.sources.find(s => s.id === file.source)
    if (source.host === 'github') {
      const evidence = read(new URL('evidence/github-kernel-metadata.json', fixtureRoot))
      assert.equal(source.repo, evidence.repo)
      assert.equal(source.revision, evidence.revision)
      const record = evidence.files[file.source_path]
      assert.ok(record, file.source_path)
      assert.equal(file.size, record.size)
      assert.equal(file.sha256, record.sha256)
      if (file.path === 'LICENSE_BINARY.txt') {
        const bytes = readFileSync(new URL('evidence/LICENSE_BINARY.txt', fixtureRoot))
        assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256)
      }
      continue
    }
    const meta = source.id === 'flm' ? metadata : read(new URL('evidence/hf-license-metadata.json', fixtureRoot))
    assert.equal(source.revision, meta.sha)
    const upstreamFile = meta.siblings.find(f => f.rfilename === file.source_path)
    assert.ok(upstreamFile, file.path)
    assert.equal(file.size, upstreamFile.size)
    if (upstreamFile.lfs) assert.equal(file.sha256, upstreamFile.lfs.sha256)
    else {
      const bytes = readFileSync(new URL(`evidence/${file.path}`, fixtureRoot))
      assert.equal(bytes.length, file.size)
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256)
    }
  }
  assert.ok(read(new URL('evidence/tokenizer_config.json', fixtureRoot)).chat_template)
  assert.throws(() => validateFastflowlm(entry), /unqualified candidate/)
})

test('the candidate pins the four working Qwen3 kernels to the engine commit', () => {
  const d = candidate().definition
  const source = d.sources.find(s => s.host === 'github')
  assert.ok(source, 'missing GitHub kernel source')
  assert.equal(source.repo, 'ROCm/FastFlowLM')
  assert.equal(source.revision, 'f37cdd29edc777cf3db1e385da8e7bfadc57d0b3')
  for (const name of ['attn.xclbin', 'dequant.xclbin', 'layer.xclbin', 'mm.xclbin']) {
    const file = d.files.find(f => f.path === name)
    assert.equal(file.source, source.id)
    assert.equal(file.source_path, 'src/xclbins/Qwen3-0.6B-NPU2/' + name)
  }
  assert.equal(d.files.find(f => f.path === 'lm_head.xclbin').source, 'flm')
  assert.ok(d.files.some(f => f.source === source.id && f.path === 'LICENSE_BINARY.txt'))
  assert.ok(d.components.metadata.includes('LICENSE_BINARY.txt'))
})

test('file plan rejects missing small-file hash, missing kernel, wrong source and unsafe paths', () => {
  for (const mutate of [
    d => delete d.files.find(f => f.path === 'config.json').sha256,
    d => d.files = d.files.filter(f => f.path !== d.components.kernels[0]),
    d => d.files[0].source = 'missing', d => d.sources[0].revision = 'main',
    d => d.sources[0].host = 'https://example.org', d => d.sources[0].host = null,
    d => d.sources[0].repo = '../outside', d => d.sources[0].repo = 'org/..',
    d => d.sources.push(d.sources[0]), d => d.files.push(d.files[0]),
    d => d.files[0].path = '../outside', d => d.files[0].path = 'C:/outside',
    d => d.files[0].source_path = 'weights\\model', d => d.files[0].path = 'NUL.txt',
    d => d.files.push({ ...d.files[0], path: d.files[0].path.toUpperCase() }),
    d => d.files.push({ ...d.files[0], path: `${d.files[0].path}/child` }),
    d => d.components.tokenizer = [], d => d.components.chat_template = [],
    d => d.files[0].sha256 = 'a'.repeat(40), d => d.local_only_protocol = 2,
    d => d.qualification = { status: 'qualified', evidence: [] },
  ]) {
    const entry = candidate(); mutate(entry.definition)
    assert.throws(() => validateFastflowlm(entry, allow))
  }
})

test('strict catalog schema accepts candidate shape and rejects unknown FLM fields', () => {
  const check = data => {
    const path = join(scratch, 'schema-input.json'); writeFileSync(path, JSON.stringify(data))
    return spawnSync('npx', ['--yes', 'ajv-cli@5', 'validate', '-s', 'models/schema.catalog.json', '-d', path, '--strict=false'], { encoding: 'utf8' })
  }
  for (const mode of ['candidate', 'chat']) {
    const good = check(consumerCatalog(mode)); assert.equal(good.status, 0, good.stderr)
  }
  for (const mutate of [d => d.sources[0].host = 'http', d => d.sources[0].repo = '../outside', d => d.command = 'run', d => d.files[0].url = 'https://example.org/model', d => d.capabilities.vision = true, d => delete d.license]) {
    const data = consumerCatalog(); mutate(data.models['fastflowlm:qwen3-0.6b'].definition)
    const result = check(data); assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /invalid/)
  }
})

test('pinned old core parser reads new/unknown entries and every old collection stays unchanged', () => {
  const provenance = read(new URL('legacy-model-catalog.provenance.json', fixtureRoot))
  assert.equal(createHash('sha256').update(readFileSync(new URL('legacy-model-catalog.ts', fixtureRoot))).digest('hex'), provenance.sha256)
  const baseline = consumerCatalog('old-cache')
  for (const mode of ['production', 'candidate', 'chat', 'unknown']) {
    const next = consumerCatalog(mode)
    parseAtomicModelCatalog(next)
    for (const name of ['recommended', ...Object.keys(COLLECTION_FIELDS)]) {
      assert.deepEqual(projectCollection(next, name), projectCollection(baseline, name))
      // This older parser predates the audio collection too.
      if (name !== 'audio') assert.deepEqual(projectAtomicModelCollection(next, name), projectAtomicModelCollection(baseline, name))
    }
  }
  assert.deepEqual(projectFastflowlm(baseline), { schema_version: 1, models: [] })
  assert.equal(projectFastflowlm(consumerCatalog('unknown'), allow).models.length, 1)
  assert.throws(() => validateCatalog(consumerCatalog()), /unqualified candidate/)
  const duplicate = consumerCatalog()
  duplicate.collections['fastflowlm-models'].entries.push(duplicate.collections['fastflowlm-models'].entries[0])
  assert.throws(() => projectFastflowlm(duplicate, allow), /Duplicate/)
  const wrongVariant = consumerCatalog()
  wrongVariant.collections['fastflowlm-models'].entries[0].variant = 'missing'
  assert.throws(() => projectFastflowlm(wrongVariant, allow), /reference/)
  const duplicateVariant = consumerCatalog()
  duplicateVariant.models['fastflowlm:duplicate'] = structuredClone(duplicateVariant.models['fastflowlm:qwen3-0.6b'])
  assert.throws(() => validateCatalog(duplicateVariant, allow), /Duplicate FastFlowLM variant_id/)
})

// Models added to a legacy collection after the pinned baseline: their whole entries are the only
// bytes a legacy export may gain (older clients skip a family id they do not know).
const ADDED_SINCE_BASELINE = { diffusion: ['minimax-h3-image'] }

/** `text` without the pretty-printed array entries whose `"id"` is in `ids`, and their leading comma. */
function withoutEntries(text, ids) {
  for (const id of ids) {
    const at = text.indexOf(`"id": "${id}"`)
    assert.notEqual(at, -1, `${id} is not in the export`)
    const open = text.lastIndexOf('{', at)
    let depth = 0, end = open
    for (; end < text.length; end++) {
      if (text[end] === '{') depth++
      else if (text[end] === '}' && --depth === 0) break
    }
    const comma = text.lastIndexOf(',', open)
    assert.match(text.slice(comma, open), /^,\s*$/, `${id} is not a whole array entry`)
    text = text.slice(0, comma) + text.slice(end + 1)
  }
  return text
}

test('all legacy payload bytes match the pre-FLM git baseline', () => {
  // Pinned merge base; changing a legacy export is outside tasks 1.1–1.5. Later model additions
  // (ADDED_SINCE_BASELINE) are removed before the comparison, so every older byte still has to match.
  for (const name of ['recommended', ...Object.keys(COLLECTION_FIELDS)]) {
    const path = `models/${name}.json`
    const before = spawnSync('git', ['show', `5741fd4:${path}`])
    assert.equal(before.status, 0)
    const added = ADDED_SINCE_BASELINE[name]
    if (added) assert.equal(withoutEntries(readFileSync(path, 'utf8'), added), before.stdout.toString('utf8'), path)
    else assert.deepEqual(readFileSync(path), before.stdout, path)
  }
  assert.equal(existsSync('models/fastflowlm-models.json'), false)
})

test('legacy refresh cannot silently repin FLM while retaining old hashes or qualification', async () => {
  const data = consumerCatalog()
  const model = data.models['fastflowlm:qwen3-0.6b']
  // Synthetic qualified copy tests the guard without claiming real qualification.
  model.definition.qualification = { status: 'qualified', evidence: ['https://example.org/test-only-evidence'] }
  let requests = 0
  await assert.rejects(refreshCatalogSource(data, 'fastflowlm:qwen3-0.6b', model.definition.sources[0].repo, 'a'.repeat(40), { fetch: async () => { requests++; throw new Error('network must not be used') } }), /complete staged file plan/)
  assert.equal(requests, 0)
})

test('file and trusted HTTPS consumers receive identical fixtures without production URLs', async () => {
  writeConsumerFixtures(scratch, 'chat')
  const cert = join(scratch, 'cert.pem'), key = join(scratch, 'key.pem')
  const openssl = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', key, '-out', cert, '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { encoding: 'utf8' })
  assert.equal(openssl.status, 0, openssl.stderr)
  const names = fixtureNames
  const server = fixtureServer(scratch, { key: readFileSync(key), cert: readFileSync(cert) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  try {
    for (const name of names) {
      const local = read(pathToFileURL(join(scratch, name)))
      const remote = await new Promise((resolve, reject) => {
        get(`https://127.0.0.1:${server.address().port}/${name}`, { ca: readFileSync(cert) }, response => {
          let body = ''; response.setEncoding('utf8'); response.on('data', chunk => body += chunk)
          response.on('end', () => { try { resolve(JSON.parse(body)) } catch (e) { reject(e) } })
        }).on('error', reject)
      })
      assert.deepEqual(remote, local)
      if (name === 'catalog.json') { parseAtomicModelCatalog(remote); assert.equal(projectFastflowlm(remote, allow).models.length, chatCheckpoints.length) }
      else {
        const source = name === 'fastflowlm-manifest.json' ? `backends/${name}` : `runtimes/environments/${name}`
        assert.deepEqual(remote, read(new URL(`../../${source}`, import.meta.url)))
      }
    }
  } finally { await new Promise(resolve => server.close(resolve)) }
})
