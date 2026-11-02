import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { projectCollection, validateCatalog } from './model-catalog.mjs'

const directoryFlag = process.argv.indexOf('--directory')
const directory = directoryFlag < 0 ? new URL('../../models/', import.meta.url) : pathToFileURL(resolve(process.argv[directoryFlag + 1]) + '/')
const catalog = validateCatalog(JSON.parse(readFileSync(new URL('catalog.json', directory), 'utf8')))
let failed = false
for (let i = 0; i < process.argv.length; i++) if (process.argv[i] === '--baseline') {
  const target = resolve(process.argv[++i])
  if (process.argv.includes('--check')) {
    if (!isDeepStrictEqual(JSON.parse(readFileSync(target, 'utf8')), catalog)) {
      console.error(`${target} differs from the canonical model catalog`)
      failed = true
    }
  } else writeFileSync(target, JSON.stringify(catalog, null, 2) + '\n')
}

for (const name of Object.keys(catalog.collections)) {
  const target = new URL(`${name}.json`, directory)
  const expected = projectCollection(catalog, name)
  if (process.argv.includes('--check')) {
    const actual = JSON.parse(readFileSync(target, 'utf8'))
    if (!isDeepStrictEqual(actual, expected)) {
      console.error(`${fileURLToPath(target)} differs from models/catalog.json; run node .github/scripts/export-model-catalog.mjs`)
      failed = true
    }
  } else writeFileSync(target, JSON.stringify(expected, null, 2) + '\n')
}
if (failed) process.exitCode = 1
else console.log(`Model catalog: ${Object.keys(catalog.models).length} models, ${Object.keys(catalog.collections).length} compatible exports verified`)
