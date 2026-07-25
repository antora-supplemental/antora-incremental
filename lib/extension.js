'use strict'

const fs = require('node:fs')
const ospath = require('node:path')
const { pageId, resourceId } = require('./ids.js')
const { scanAsciiDocDeps } = require('./scan.js')
const { computeDirtySet } = require('./dirty.js')

const MANIFEST_NAME = '.antora-deps.json'

/**
 * Antora extension: emit dependency manifest; optional partial reconvert via dirty set.
 *
 * Config / env:
 * - output: relative name under site output (default .antora-deps.json)
 * - dirtyFile / ANTORA_INCREMENTAL_DIRTY_FILE: JSON from antora-dirty
 * - priorSite / ANTORA_INCREMENTAL_PRIOR_SITE: previous site root for HTML reuse
 */
function register ({ config = {} } = {}) {
  const context = this
  const manifestName = config.output || MANIFEST_NAME
  let dirtySet = null
  let priorSite = process.env.ANTORA_INCREMENTAL_PRIOR_SITE || config.priorSite || null
  const dirtyFile = process.env.ANTORA_INCREMENTAL_DIRTY_FILE || config.dirtyFile || null

  if (dirtyFile && fs.existsSync(dirtyFile)) {
    try {
      dirtySet = JSON.parse(fs.readFileSync(dirtyFile, 'utf8'))
    } catch (err) {
      console.warn(`[antora-incremental] failed to read dirty file: ${err.message}`)
    }
  }

  context.on('contextStarted', () => {
    if (!dirtySet?.pages?.length) return
    const dirty = new Set(dirtySet.pages)
    const forceFull = dirtySet.forceFull
    if (forceFull) return

    try {
      const convertDocument = context.getFunctions().convertDocument
      if (typeof convertDocument !== 'function') return

      let converted = 0
      let skipped = 0

      context.replaceFunctions({
        convertDocument (file, ...rest) {
          if (file.src?.family !== 'page') return convertDocument.call(this, file, ...rest)
          const id = pageId(file)
          if (!id || dirty.has(id)) {
            converted += 1
            return convertDocument.call(this, file, ...rest)
          }
          if (priorSite && tryReusePriorHtml(file, priorSite)) {
            skipped += 1
            return file
          }
          converted += 1
          return convertDocument.call(this, file, ...rest)
        },
      })

      context.on('documentsConverted', () => {
        console.log(
          `[antora-incremental] convert metrics: converted=${converted} reused=${skipped} dirty=${dirty.size}`
        )
      })
    } catch (err) {
      console.warn(`[antora-incremental] partial convert hook unavailable: ${err.message}`)
    }
  })

  context.on('documentsConverted', ({ contentCatalog }) => {
    contentCatalog.antoraIncrementalScan = buildScan(contentCatalog)
  })

  context.on('sitePublished', ({ playbook, contentCatalog }) => {
    const scan = contentCatalog.antoraIncrementalScan || buildScan(contentCatalog)
    const outDir = ospath.resolve(playbook.dir || process.cwd(), playbook.output?.dir || 'build/site')
    const dest = ospath.join(outDir, manifestName)
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(dest, JSON.stringify(scan, null, 2))
    console.log(`[antora-incremental] wrote ${dest} (${Object.keys(scan.pages).length} pages)`)
  })
}

function buildScan (contentCatalog) {
  const pages = {}
  const partialToIncluders = {}
  const xrefTargetToReferrers = {}
  const nav = {}
  const sources = new Map()

  for (const file of contentCatalog.getFiles()) {
    const origin = file.src?.origin
    if (origin?.url) {
      const key = `${origin.url}::${origin.refname || origin.refhash || ''}::${origin.startPath || ''}`
      if (!sources.has(key)) {
        sources.set(key, {
          url: origin.url,
          refname: origin.refname || null,
          refhash: origin.refhash || null,
          startPath: origin.startPath || '',
          worktree: Boolean(origin.worktree),
        })
      }
    }
  }

  for (const file of contentCatalog.findBy({ family: 'page' })) {
    const id = pageId(file)
    if (!id) continue
    const relPath = file.src?.path || file.path || ''
    const raw = file.src?.contents
      ? Buffer.isBuffer(file.src.contents)
        ? file.src.contents.toString('utf8')
        : String(file.src.contents)
      : file.contents
        ? Buffer.isBuffer(file.contents)
          ? // post-convert HTML — prefer asciidoc source if kept
            ''
          : String(file.contents)
        : ''

    // Prefer reading from disk origin path when available for accurate include scan.
    let sourceText = ''
    const abspath = file.src?.abspath
    if (abspath && fs.existsSync(abspath)) {
      try {
        sourceText = fs.readFileSync(abspath, 'utf8')
      } catch (_) {}
    }
    if (!sourceText && file.src?.contents) {
      sourceText = Buffer.isBuffer(file.src.contents) ? file.src.contents.toString('utf8') : String(file.src.contents)
    }

    const deps = scanAsciiDocDeps(sourceText || raw)
    const originUrl = file.src?.origin?.url || null
    const startPath = file.src?.origin?.startPath || ''

    pages[id] = {
      path: relPath,
      abspath: abspath || null,
      originUrl,
      startPath,
      module: file.src?.module || 'ROOT',
      component: file.src?.component,
      version: file.src?.version,
      includes: deps.includes,
      xrefs: deps.xrefs,
      aliases: deps.aliases,
    }

    for (const inc of deps.includes) {
      const key = normalizeIncludeKey(originUrl, startPath, inc, relPath)
      if (!partialToIncluders[key]) partialToIncluders[key] = []
      if (!partialToIncluders[key].includes(id)) partialToIncluders[key].push(id)
    }
    for (const xref of deps.xrefs) {
      if (!xrefTargetToReferrers[xref]) xrefTargetToReferrers[xref] = []
      if (!xrefTargetToReferrers[xref].includes(id)) xrefTargetToReferrers[xref].push(id)
    }
  }

  for (const file of contentCatalog.findBy({ family: 'nav' })) {
    const nid = resourceId(file) || pageId(file) || file.src?.path
    if (!nid) continue
    const comp = file.src?.component
    const ver = file.src?.version
    const memberPages = Object.keys(pages).filter((pid) => {
      const p = pages[pid]
      return p.component === comp && p.version === ver
    })
    nav[nid] = {
      path: file.src?.path || file.path,
      abspath: file.src?.abspath || null,
      originUrl: file.src?.origin?.url || null,
      startPath: file.src?.origin?.startPath || '',
      pages: memberPages,
    }
  }

  // Alias files (family alias) if present
  const aliases = {}
  for (const file of contentCatalog.findBy({ family: 'alias' })) {
    const aid = resourceId(file) || file.pub?.url || file.src?.path
    const target = file.rel ? pageId(file.rel) : null
    if (aid) aliases[aid] = { path: file.src?.path, target, abspath: file.src?.abspath || null }
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    sources: [...sources.values()],
    pages,
    nav,
    aliases,
    partialToIncluders,
    xrefTargetToReferrers,
  }
}

function normalizeIncludeKey (originUrl, startPath, includeTarget, fromPath) {
  // include targets are often relative like partial$foo.adoc or modules/.../partials/x.adoc
  return `${originUrl || ''}::${startPath || ''}::${includeTarget}::from:${fromPath}`
}

function tryReusePriorHtml (file, priorSite) {
  const pubPath = file.pub?.path || file.out?.path
  if (!pubPath) return false
  const prior = ospath.join(priorSite, pubPath)
  if (!fs.existsSync(prior)) return false
  try {
    file.contents = fs.readFileSync(prior)
    file.mediaType = 'text/html'
    // Prevent downstream assuming AsciiDoc source is authoritative for contents.
    if (file.asciidoc) file.asciidoc.incrementalReused = true
    return true
  } catch (_) {
    return false
  }
}

module.exports = { register, buildScan, MANIFEST_NAME, computeDirtySet }
