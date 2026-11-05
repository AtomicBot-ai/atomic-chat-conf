// Materialize consumer fixtures from the current catalog without copying or publishing it.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateCatalog } from './model-catalog.mjs'
export const fixtureRoot = new URL('../fixtures/fastflowlm/', import.meta.url)
const read = url => JSON.parse(readFileSync(url, 'utf8'))
export function consumerCatalog(mode = 'candidate') {
  const catalog = read(new URL('../../models/catalog.json', import.meta.url))
  const allowCandidates = ['candidate', 'chat', 'unknown'].includes(mode)
  if (mode === 'old-cache') {
    delete catalog.collections['fastflowlm-models']
    for (const [id, entry] of Object.entries(catalog.models)) if (entry.kind === 'fastflowlm') delete catalog.models[id]
  } else if (allowCandidates) {
    const directory = new URL('model-candidates/', fixtureRoot)
    const candidates = mode === 'chat'
      ? readdirSync(directory).filter(name => name.endsWith('.json')).sort().map(name => read(new URL(name, directory)))
      : [read(new URL('model-candidate.json', fixtureRoot))]
    const entries = []
    for (const entry of candidates) {
      const model = `fastflowlm:${entry.definition.model_id}`
      if (Object.hasOwn(catalog.models, model)) throw new Error(`Duplicate staging model: ${model}`)
      catalog.models[model] = entry
      entries.push({ model, variant: entry.definition.variant_id })
    }
    catalog.collections['fastflowlm-models'] = { header: { schema_version: 1 }, entries }
    if (mode === 'unknown') {
      catalog.models['future:test'] = { kind: 'future-engine', format: 'future-format', definition: {}, variants: { default: {} } }
      catalog.collections['future-models'] = { header: { schema_version: 1 }, entries: [{ model: 'future:test', variant: 'default' }] }
    }
  } else if (mode !== 'production') throw new Error('Mode must be production, candidate, chat, old-cache or unknown')
  return validateCatalog(catalog, { allowCandidates })
}
export function writeConsumerFixtures(directory, mode) {
  mkdirSync(directory, { recursive: true })
  writeFileSync(resolve(directory, 'catalog.json'), JSON.stringify(consumerCatalog(mode), null, 2) + '\n')
  for (const [source, target] of [
    ['backends/fastflowlm-manifest.json', 'fastflowlm-manifest.json'],
    ['runtimes/environments/fastflowlm-windows.json', 'fastflowlm-windows.json'],
    ['runtimes/environments/fastflowlm-linux.json', 'fastflowlm-linux.json'],
  ]) writeFileSync(resolve(directory, target), readFileSync(new URL(`../../${source}`, import.meta.url)))
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node .github/scripts/fastflowlm-fixtures.mjs OUTPUT_DIRECTORY [candidate|chat|old-cache|unknown|production]')
  writeConsumerFixtures(resolve(process.argv[2]), process.argv[3] ?? 'candidate')
  console.log(`Consumer fixtures written to ${resolve(process.argv[2])}; no managed builds or qualified recipes supplied`)
}
