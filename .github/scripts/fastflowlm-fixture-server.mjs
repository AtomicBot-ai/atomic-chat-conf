import { createServer } from 'node:https'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const fixtureNames = ['catalog.json', 'fastflowlm-manifest.json', 'fastflowlm-windows.json', 'fastflowlm-linux.json']
export function fixtureServer(directory, tls) {
  return createServer(tls, (request, response) => {
    const name = request.url?.slice(1)
    if (request.method !== 'GET' || !fixtureNames.includes(name)) { response.writeHead(404).end(); return }
    try {
      const body = readFileSync(resolve(directory, name))
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(body)
    } catch { response.writeHead(404).end() }
  })
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [directory, key, cert] = process.argv.slice(2)
  if (!directory || !key || !cert) throw new Error('Usage: node fastflowlm-fixture-server.mjs DIRECTORY KEY_PEM CERT_PEM')
  fixtureServer(directory, { key: readFileSync(key), cert: readFileSync(cert) }).listen(8443, '127.0.0.1', () => console.log('FastFlowLM fixtures: https://localhost:8443 (loopback only)'))
}
