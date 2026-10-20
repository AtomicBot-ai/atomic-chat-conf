#!/usr/bin/env node
// Stands in for the gh CLI in the sd.cpp approval tests: core's
// engine-candidate runs come from runs.json, a run's results artifact from
// results/<run id>.json (none: no artifact), this repository's releases from
// releases/<tag>.json. fakeGhPath() gives a PATH that finds it as `gh`.

import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** PATH with a `gh` that runs this file first. */
export function fakeGhPath() {
  const bin = mkdtempSync(join(tmpdir(), 'fake-gh-'))
  const shim = join(bin, 'gh')
  writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${fileURLToPath(import.meta.url)}" "$@"\n`)
  chmodSync(shim, 0o755)
  return `${bin}:${process.env.PATH}`
}

function gh(argv) {
  const [command, sub, ...rest] = argv
  const flag = (name) => rest[rest.indexOf(name) + 1]
  if (command === 'run' && sub === 'list') {
    process.stdout.write(readFileSync(join(here, 'runs.json'), 'utf8'))
    return 0
  }
  if (command === 'run' && sub === 'download') {
    const results = join(here, 'results', `${rest[0]}.json`)
    if (!existsSync(results)) {
      process.stderr.write('no valid artifacts found to download\n')
      return 1
    }
    copyFileSync(results, join(flag('--dir'), 'results.json'))
    return 0
  }
  const release = command === 'api' && /^repos\/[^/]+\/[^/]+\/releases\/tags\/(.+)$/.exec(sub ?? '')
  if (release) {
    const file = join(here, 'releases', `${release[1]}.json`)
    if (!existsSync(file)) {
      process.stderr.write('gh: Not Found (HTTP 404)\n')
      return 1
    }
    process.stdout.write(readFileSync(file, 'utf8'))
    return 0
  }
  process.stderr.write(`fake gh: ${argv.join(' ')} is not served\n`)
  return 2
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(gh(process.argv.slice(2)))
}
