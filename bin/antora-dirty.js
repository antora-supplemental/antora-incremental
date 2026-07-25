#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const { computeDirtySet, loadManifest } = require('../lib/dirty.js')

function main (argv = process.argv.slice(2)) {
  if (argv.includes('-h') || argv.includes('--help') || argv.length < 2) {
    process.stdout.write(`Usage: antora-dirty <manifest.json> <changed-path> [<changed-path>...]
       antora-dirty <manifest.json> --stdin

Reads .antora-deps.json + changed source paths; prints dirty-set JSON.
`)
    return argv.includes('-h') || argv.includes('--help') ? 0 : 1
  }

  const manifestPath = argv[0]
  let paths = argv.slice(1)
  if (paths[0] === '--stdin') {
    const input = fs.readFileSync(0, 'utf8')
    paths = input.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  }

  const manifest = loadManifest(manifestPath)
  const result = computeDirtySet(manifest, paths)
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  return 0
}

module.exports = { main }

if (require.main === module) {
  process.exitCode = main()
}
