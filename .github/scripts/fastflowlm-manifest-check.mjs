import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { canonicalJSON, readJsonAtRef, checkManifestImmutability } from './runtime-descriptor-immutability.mjs'

export const BUILD_PATH = 'backends/fastflowlm-manifest.json'
export const ENVIRONMENT_PATHS = ['windows', 'linux'].map(os => `runtimes/environments/fastflowlm-${os}.json`)
export const buildParts = version => /^flm-(\d+)\.(\d+)\.(\d+)-r(\d+)$/.exec(version)?.slice(1).map(BigInt)
export function compareBuilds(a, b) {
  const left = buildParts(a), right = buildParts(b)
  if (!left || !right) throw new Error('Invalid FastFlowLM build version')
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1
  return 0
}

export function checkBuilds(data, base = null) {
  const errors = [], ids = new Set()
  let previous
  for (const release of data.releases ?? []) {
    const parts = buildParts(release.version)
    if (!parts || parts[3] !== BigInt(release.atomic_revision ?? 0)) errors.push('Build id must match atomic_revision')
    if (ids.has(release.version)) errors.push(`Duplicate build ${release.version}`)
    ids.add(release.version)
    if (previous && parts && compareBuilds(previous, release.version) <= 0) errors.push('Builds must be newest first by numeric version/revision')
    previous = parts ? release.version : undefined
    const platforms = release.assets?.map(a => a.platform) ?? []
    if (platforms.length !== 2 || new Set(platforms).size !== 2 || !['win-x64-npu', 'linux-x64-npu'].every(p => platforms.includes(p))) errors.push('Exactly one asset per Windows/Linux platform is required')
    for (const blob of [...(release.assets ?? []), release.provenance?.document]) {
      if (!blob?.sha256 || !/^[a-f0-9]{64}$/.test(blob.sha256)) errors.push('Missing or invalid SHA-256')
      if (!blob?.url?.includes(`/releases/download/${release.version}/`)) errors.push('Asset/provenance URL must use the immutable build tag')
    }
    if (release.local_only_protocol !== 1) errors.push('Unsupported local_only_protocol')
    if (typeof release.published_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(release.published_at) || !Number.isFinite(Date.parse(release.published_at))) errors.push('Invalid publication timestamp')
  }
  for (const old of base?.releases ?? []) {
    const now = data.releases?.find(r => r.version === old.version)
    if (now && canonicalJSON(now) !== canonicalJSON(old)) errors.push(`Immutable build ${old.version} changed`)
  }
  return errors
}

export function checkEnvironment(data, base = null) {
  const errors = [], recipes = new Set(), platforms = new Set()
  const immutable = checkManifestImmutability(base, data)
  if (!immutable.ok) errors.push(immutable.reason)
  if (!data.manifest_id?.startsWith(`fastflowlm-${data.platform}-r`)) errors.push('manifest_id does not match platform')
  for (const recipe of data.recipes ?? []) {
    const key = `${recipe.recipe_id}@${recipe.revision}`
    if (recipes.has(key)) errors.push(`Duplicate recipe ${key}`)
    recipes.add(key)
    if (recipe.action !== `${data.platform}.install-amd-npu`) errors.push('Recipe action does not match platform')
    if (!recipe.qualification?.evidence?.url?.includes(`/releases/download/${recipe.qualification.build_version}/`)) errors.push('Live evidence must belong to the qualified build tag')
    for (const platform of recipe.platforms ?? []) {
      for (const device of recipe.hardware?.pci_device_ids ?? []) {
        const key = canonicalJSON({ platform, device })
        if (platforms.has(key)) errors.push('Ambiguous qualified platform/device')
        platforms.add(key)
      }
    }
    if (data.platform === 'windows') {
      const expected = recipe.driver?.kind === 'windows-update-cab' ? 'https://catalog.s.download.windowsupdate.com/' : 'https://download.amd.com/'
      if (!recipe.driver?.url?.startsWith(expected)) errors.push('Driver source does not match package kind')
    }
    if (data.platform === 'linux') {
      const sources = new Map(), packages = new Set()
      for (const source of recipe.sources ?? []) {
        if (sources.has(source.id)) errors.push('Duplicate dependency source')
        sources.set(source.id, source)
        for (const platform of recipe.platforms ?? []) {
          const suite = platform.version === '24.04' ? 'noble' : 'resolute'
          if (!source.suite.startsWith(suite)) errors.push('Package source suite does not match Ubuntu version')
        }
      }
      for (const pkg of recipe.packages ?? []) {
        if (!sources.has(pkg.source)) errors.push('Unknown package source')
        if (packages.has(pkg.name)) errors.push('Duplicate package')
        packages.add(pkg.name)
        if (pkg.path.split('/').some(p => !p || p === '.' || p === '..')) errors.push('Unsafe package path')
      }
      if (recipe.xrt === 'system' && !packages.has('libxrt-npu2')) errors.push('System XRT needs its NPU plugin package')
    }
    const old = base?.recipes?.find(r => r.recipe_id === recipe.recipe_id && r.revision === recipe.revision)
    if (old && canonicalJSON(old) !== canonicalJSON(recipe)) errors.push(`Immutable recipe ${key} changed; bump recipe revision too`)
  }
  return errors
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ref = process.env.FASTFLOWLM_BASE_REF ?? 'origin/main'
  for (const path of [BUILD_PATH, ...ENVIRONMENT_PATHS]) {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    const base = readJsonAtRef(ref, path)
    const errors = path === BUILD_PATH ? checkBuilds(data, base) : checkEnvironment(data, base)
    if (errors.length) { console.error(`${path}:\n${errors.join('\n')}`); process.exitCode = 1 }
    else console.log(`${path}: integrity and immutability passed`)
  }
}
