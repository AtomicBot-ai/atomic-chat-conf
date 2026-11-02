// Explicitly update one model source; generation and CI never perform network requests.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { COMMIT, validateCatalog } from './model-catalog.mjs'

export async function refreshCatalogSource(input, id, repo, revision, { fetch: request = fetch, now = () => new Date() } = {}) {
if (!id || !repo || !COMMIT.test(revision ?? '')) throw new Error('Use a model id, owner/repo and full commit SHA')
const catalog = validateCatalog(structuredClone(input))
const model = catalog.models[id]
if (!model) throw new Error(`Unknown model ${id}`)
const response = await request(`https://huggingface.co/api/models/${repo}/revision/${revision}?blobs=true&files_metadata=true`)
if (!response.ok) throw new Error(`Hugging Face returned HTTP ${response.status}`)
const metadata = await response.json()
if (metadata.sha !== revision) throw new Error('Hugging Face returned another commit')
let changed = 0
async function visit(value, active = false) {
  if (Array.isArray(value)) return Promise.all(value.map(v => visit(v, active)))
  if (!value || typeof value !== 'object') return
  const own = value.repo ?? value.model_name
  if (own) active = own === repo
  if (active && own) { value.revision = revision; changed++ }
  if (active && Array.isArray(value.required)) for (const path of value.required) {
    if (!metadata.siblings?.some(file => file.rfilename === path)) throw new Error(`Missing required ${path} at ${revision}`)
  }
  const name = value.path ?? value.filename ?? value.file
  if (active && typeof name === 'string' && ('bytes' in value || 'size' in value || 'sha256' in value)) {
    const file = metadata.siblings?.find(f => f.rfilename === name)
    if (!file) throw new Error(`Missing ${name} at ${revision}`)
    if ('bytes' in value) value.bytes = file.lfs?.size ?? file.size
    if ('size' in value) value.size = file.lfs?.size ?? file.size
    if ('sha256' in value || file.lfs?.sha256) {
      if (file.lfs?.sha256) value.sha256 = file.lfs.sha256
      else {
        if (!Number.isSafeInteger(file.size) || file.size > 10 * 1024 * 1024) throw new Error(`No published SHA-256 for large file ${name}`)
        const response = await request(`https://huggingface.co/${repo}/resolve/${revision}/${name.split('/').map(encodeURIComponent).join('/')}`)
        if (!response.ok) throw new Error(`Could not hash ${name}: HTTP ${response.status}`)
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.length !== file.size) throw new Error(`Unexpected content size for ${name}`)
        value.sha256 = createHash('sha256').update(bytes).digest('hex')
      }
    }
  }
  await Promise.all(Object.values(value).map(v => visit(v, active)))
}
await visit(model.definition)
await visit(model.variants, model.definition.repo === repo)
await visit(model.files, (model.definition.repo ?? model.definition.model_name) === repo)
if (!changed) throw new Error(`${id} does not reference ${repo}`)
catalog.updated_at = now().toISOString()
const refers = value => !!value && typeof value === 'object' && (value.model === id || Object.values(value).some(refers))
for (const collection of Object.values(catalog.collections)) if (refers(collection)) collection.header.updated_at = catalog.updated_at
validateCatalog(catalog)
return catalog
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [id, repo, revision] = process.argv.slice(2)
  const file = new URL('../../models/catalog.json', import.meta.url)
  const catalog = await refreshCatalogSource(JSON.parse(readFileSync(file, 'utf8')), id, repo, revision)
  writeFileSync(file, JSON.stringify(catalog, null, 2) + '\n')
  console.log(`Updated ${id} to ${repo}@${revision}; regenerate and review compatible exports before publishing.`)
}
