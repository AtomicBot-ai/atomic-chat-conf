import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = new URL('../fixtures/fastflowlm/', import.meta.url)
const bytes = name => readFileSync(new URL(name, root))
const json = name => JSON.parse(bytes(name))
const sha = data => createHash('sha256').update(data).digest('hex')
const scratch = mkdtempSync(join(tmpdir(), 'flm-source-evidence-'))
after(() => rmSync(scratch, { recursive: true, force: true }))
const run = (command, args, options) => {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  assert.equal(result.status, 0, `${command}: ${result.error ?? result.stderr}`)
  return result
}

test('Linux candidates trace exact package versions/hashes to signed indexes for both Ubuntu targets', () => {
  const data = json('linux-candidates.json')
  assert.equal(data.qualification, 'candidate')
  assert.deepEqual(data.environments.map(e => e.version), ['24.04', '26.04'])
  const fingerprint = json('evidence/lemonade-archive.json').signing_key_fingerprint
  assert.equal(fingerprint, '881CF4B40B0BFA288D6776E83BF36CFA0BD50AEC')
  const keyring = join(scratch, 'lemonade.gpg')
  run('gpg', ['--batch', '--dearmor', '--output', keyring], { input: bytes('evidence/lemonade-signing-key.asc') })
  for (const env of data.environments) {
    assert.equal(env.qualification, 'candidate')
    assert.equal(env.sources[0].signing_fingerprint, fingerprint)
    const suite = env.sources[0].suite
    assert.equal(suite, env.version === '24.04' ? 'noble' : 'resolute')
    const release = new URL(`evidence/${suite}-InRelease`, root)
    const verified = run('gpgv', ['--keyring', keyring, '--status-fd', '1', fileURLToPath(release)])
    assert.match(verified.stdout, new RegExp(`VALIDSIG ${fingerprint} `))
    const compressed = bytes(`evidence/${suite}-Packages.gz`)
    assert.match(bytes(`evidence/${suite}-InRelease`).toString(), new RegExp(`${sha(compressed)}\\s+${compressed.length}\\s+main/binary-amd64/Packages\\.gz`))
    const stanzas = gunzipSync(compressed).toString().split('\n\n').map(block => Object.fromEntries(block.split('\n').filter(line => /^\S[^:]*: /.test(line)).map(line => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 2)])))
    assert.deepEqual(env.packages.map(p => p.name).sort(), ['amdxdna-dkms', 'libxrt-npu2', 'libxrt-utils', 'libxrt-utils-npu', 'libxrt2'].sort())
    for (const pkg of env.packages) {
      const record = stanzas.find(s => s.Package === pkg.name && s.Version === pkg.version)
      assert.ok(record)
      assert.equal(pkg.sha256, record.SHA256)
      assert.equal(pkg.size, Number(record.Size))
      assert.equal(pkg.path, record.Filename)
      assert.equal(pkg.architecture, record.Architecture)
      assert.equal(pkg.depends, record.Depends)
      assert.equal(pkg.download_verified, true)
    }
    const inventory = bytes(`evidence/${suite}-dkms-inventory.txt`).toString()
    for (const file of env.firmware.files) assert.ok(inventory.includes(file))
  }
})

test('Windows candidate matches Microsoft metadata and has an intact signed catalog containing its INF', () => {
  const data = json('windows-candidate.json'), metadata = json('evidence/windows-update-metadata.json')
  assert.equal(data.qualification, 'candidate')
  assert.equal(data.url, metadata.url)
  assert.equal(data.sha256, Buffer.from(metadata.sha256_base64, 'base64').toString('hex'))
  assert.deepEqual(data.pci_device_ids, ['1022:17f0'])
  assert.equal(data.catalog_sha256, sha(bytes('evidence/kipudrv.cat')))
  assert.equal(data.inf_sha256, sha(bytes('evidence/kipudrv.inf')))
  const signedContent = join(scratch, 'catalog-content')
  // Integrity only: Windows timestamp, revocation and kernel trust policy need native qualification.
  run('openssl', ['smime', '-verify', '-inform', 'DER', '-in', fileURLToPath(new URL('evidence/kipudrv.cat', root)), '-noverify', '-binary', '-out', signedContent])
  assert.ok(readFileSync(signedContent).includes(Buffer.from(data.inf_sha256, 'hex')))
  const certificates = run('openssl', ['pkcs7', '-inform', 'DER', '-in', fileURLToPath(new URL('evidence/kipudrv.cat', root)), '-print_certs', '-noout'])
  assert.ok(certificates.stdout.includes('Microsoft Windows Hardware Compatibility Publisher'))
  const inf = bytes('evidence/kipudrv.inf').toString()
  assert.match(inf, /DriverVer\s*=\s*10\/10\/2025,32\.00\.0203\.314/)
  assert.match(inf, /PCI\\VEN_1022&DEV_17F0/)
})
