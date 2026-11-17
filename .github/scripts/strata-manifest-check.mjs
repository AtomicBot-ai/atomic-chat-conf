import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { canonicalJSON, readJsonAtRef } from './runtime-descriptor-immutability.mjs'

export const STRATA_MANIFEST = 'backends/strata-manifest.json'
export const safePath = value => typeof value === 'string' && /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/.test(value) && value.split('/').every(p => p && p !== '.' && p !== '..')
const matrix = {
  'windows-x64': { os: 'windows', arch: 'x64', backends: ['cuda12', 'cuda13', 'hip'] },
  'linux-x64': { os: 'linux', arch: 'x64', backends: ['cuda12', 'cuda13', 'hip', 'sycl'] },
  'macos-arm64': { os: 'macos', arch: 'arm64', backends: ['metal'] },
  'linux-arm64-spark': { os: 'linux', arch: 'arm64', backends: ['cuda13'] },
}
const vendors = { cuda12: 'nvidia', cuda13: 'nvidia', hip: 'amd', metal: 'apple', sycl: 'intel' }

/** Semantic checks supplement the strict Draft-07 schema; neither replaces the other. */
export function checkStrataManifest(data, base = null) {
  const errors = [], releases = new Set()
  for (const release of data.releases ?? []) {
    if (releases.has(release.release_id)) errors.push(`Duplicate release id ${release.release_id}`)
    releases.add(release.release_id)
    if (!release.release_id?.startsWith(`strata-${release.engine_version}-r`)) errors.push('Release id must include engine version')
    const components = new Map(), variants = new Set(), used = new Set()
    for (const component of release.components ?? []) {
      if (components.has(component.id)) errors.push(`Duplicate component ${component.id}`)
      components.set(component.id, component)
      if (!/^[a-f0-9]{64}$/.test(component.sha256 ?? '')) errors.push(`Missing SHA-256 for ${component.id}`)
      if (component.executable_paths?.some(p => !safePath(p))) errors.push(`Unsafe executable path in ${component.id}`)
      if (component.kind !== 'control' && component.version !== release.engine_version) errors.push(`Incompatible compute version ${component.id}`)
      if (component.kind === 'control' && !release.control_versions?.includes(component.version)) errors.push(`Incompatible Control version ${component.id}`)
      if (component.kind === 'control' && component.structured_output && !['jsonschema', 'referencing', 'rpds', 'attrs', 'jsonschema_specifications'].every(m => component.python_modules?.includes(m))) errors.push('Structured output requires the complete validator')
    }
    for (const variant of release.variants ?? []) {
      if (variants.has(variant.id)) errors.push(`Duplicate variant ${variant.id}`)
      variants.add(variant.id)
      const host = variant.host ?? {}, platform = matrix[variant.platform]
      if (!platform || host.os !== platform.os || host.arch !== platform.arch || !platform.backends.includes(variant.backend) || host.gpu_vendor !== vendors[variant.backend]) errors.push(`Invalid OS/CPU/GPU matrix for ${variant.id}`)
      if (host.arch === 'x64' && !host.cpu_features?.length) errors.push('x64 CPU ISA must be explicit')
      if (variant.backend?.startsWith('cuda') && !host.minimum_driver) errors.push('CUDA driver floor is required')
      if (variant.platform === 'linux-arm64-spark' && (host.device_family !== 'dgx-spark' || canonicalJSON(host.gpu_architectures) !== canonicalJSON(['sm_121']))) errors.push('Linux arm64 requires DGX Spark GB10')
      if (variant.backend === 'metal' && Number(host.minimum_os_version?.split('.')[0]) < 15) errors.push('Metal requires macOS 15+')
      const families = variant.families ?? []
      if (families.includes('qwen36') && ['metal', 'sycl'].includes(variant.backend)) errors.push('Qwen3.6 does not support Metal/SYCL')
      if (families.includes('deepseek41') && ['sycl', 'cuda12'].includes(variant.backend)) errors.push('DeepSeek requires a supported compute backend')
      if (families.includes('qwen36') && variant.platform === 'linux-arm64-spark') errors.push('Qwen3.6 on Spark is untested')
      if (families.includes('deepseek41') && variant.backend === 'cuda13' && host.arch === 'x64') {
        const supported = variant.family_gpu_architectures?.deepseek41 ?? host.gpu_architectures
        if (!supported?.length || supported.some(a => !['sm_86', 'sm_89', 'sm_120'].includes(a))) errors.push('DeepSeek CUDA requires RTX 30/40/50 architectures')
      }
      if (families.includes('deepseek41') && variant.backend === 'hip') {
        const expected = host.os === 'windows' ? ['strix-halo', 'gfx1151'] : ['radeon-ai-pro-r9700', 'gfx1201']
        if (host.device_family !== expected[0] || canonicalJSON(host.gpu_architectures) !== canonicalJSON([expected[1]])) errors.push('DeepSeek HIP requires the supported device family')
      }
      const selected = []
      for (const id of variant.components ?? []) {
        const c = components.get(id)
        used.add(id)
        if (!c) { errors.push(`Unknown component ${id}`); continue }
        selected.push(c)
        if (c.platform !== variant.platform || (c.kind !== 'control' && c.backend !== variant.backend)) errors.push(`Incompatible component ${id} in ${variant.id}`)
      }
      const roles = selected.map(c => c.kind)
      if (variant.bundle) {
        const expectedPython = variant.platform === 'windows-x64' ? 'control/python/python.exe' : 'control/python/bin/python3'
        if (variant.bundle.python !== expectedPython || roles.some(role => variant.bundle.component_roots?.[role] !== (role === 'control' ? 'control' : `components/${role}`)) || Object.keys(variant.bundle.component_roots ?? {}).some(role => !roles.includes(role))) errors.push('Bundle layout differs from selected components')
      }
      if (new Set(roles).size !== roles.length || roles.filter(r => r === 'control').length !== 1) errors.push(`Variant ${variant.id} needs exactly one Control and no duplicate roles`)
      if (families.some(f => f.startsWith('qwen')) && !roles.includes('qwen')) errors.push('Missing Qwen compute')
      if (families.includes('deepseek41') && !roles.includes('deepseek')) errors.push('Missing DeepSeek compute')
    }
    for (const id of components.keys()) if (!used.has(id)) errors.push(`Unused component ${id}`)
    const old = base?.releases?.find(r => r.release_id === release.release_id)
    if (old && canonicalJSON(old) !== canonicalJSON(release)) errors.push(`Immutable release ${release.release_id} changed; use a new release id`)
  }
  return errors
}

export function checkStrataCandidate(data) {
  const errors = [], assets = new Map(), platforms = { 'windows-x86_64': 'windows-x64', 'linux-x86_64': 'linux-x64', 'linux-aarch64': 'linux-arm64-spark', 'macos-arm64': 'macos-arm64' }
  if (data.status !== 'candidate' || data.minimum_core_version !== null || !data.pending?.length) errors.push('Candidate must explicitly remain unreleased')
  const components = (data.assets ?? []).map(a => {
    if (assets.has(a.name)) errors.push('Duplicate candidate asset')
    assets.set(a.name, a)
    if (a.url !== `https://github.com/Niko1221/Strata/releases/download/${data.release_tag}/${a.name}`) errors.push('Candidate asset must match the pinned release URL')
    const platform = Object.entries(platforms).find(([raw]) => a.name.includes(raw))?.[1]
    const kind = a.name.startsWith('strata-control-') ? 'control' : a.name.startsWith('strata-dsv41-') ? 'deepseek' : 'qwen'
    const version = /^strata-(?:control|engine|dsv41)-([0-9.]+)-/.exec(a.name)?.[1]
    if (kind !== 'control' && (a.component?.version !== version || platforms[a.component?.platform] !== platform || !a.component?.entrypoint || !a.executable_paths?.includes(a.component.entrypoint))) errors.push('Candidate component metadata differs from archive identity')
    return { ...a, id: a.name, kind, platform, version, ...(kind !== 'control' ? { backend: a.component?.backend === 'cuda' ? a.component.variant : a.component?.backend } : {}) }
  })
  errors.push(...checkStrataManifest({ releases: [{ ...data, components }] }))
  for (const v of data.variants ?? []) {
    const computes = v.components.map(id => assets.get(id)).filter(a => a?.component)
    for (const a of computes) {
      const arches = a.name.startsWith('strata-dsv41-') ? v.family_gpu_architectures?.deepseek41 ?? v.host.gpu_architectures : v.host.gpu_architectures
      if (!arches.every(arch => a.component.archs.includes(arch) && v.host.gpu_architectures.includes(arch))) errors.push('Candidate GPU architectures are not present in the component')
    }
  }
  for (const p of data.packaged_candidates ?? []) {
    if (p.release_id !== data.release_id || !data.variants.some(v => v.id === p.variant)) errors.push('Packaged candidate identity differs')
  }
  return errors
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const data = JSON.parse(readFileSync(STRATA_MANIFEST, 'utf8'))
  const errors = checkStrataManifest(data, readJsonAtRef(process.env.STRATA_BASE_REF ?? 'origin/main', STRATA_MANIFEST))
  const candidate = JSON.parse(readFileSync('backends/strata-manifest.candidate.json', 'utf8'))
  errors.push(...checkStrataCandidate(candidate))
  const lockHash = createHash('sha256').update(readFileSync('.github/scripts/strata/dependencies.json')).digest('hex')
  if (candidate.dependency_lock.sha256 !== lockHash) errors.push('Candidate dependency lock digest differs')
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
  else console.log('Strata manifest: integrity and immutability passed')
}
