'use strict'

const fs = require('node:fs')
const ospath = require('node:path')

/**
 * Compute dirty pages from a manifest + changed filesystem paths.
 *
 * @param {object} manifest
 * @param {string[]} changedPaths absolute or repo-relative paths
 * @param {object} [opts]
 * @returns {{ pages: string[], navDirty: boolean, aliasDirty: boolean, searchDirty: boolean, forceFull: boolean, reasons: object }}
 */
function computeDirtySet (manifest, changedPaths, opts = {}) {
  const pages = new Set()
  const reasons = {}
  let navDirty = false
  let aliasDirty = false
  let forceFull = false

  const normalizedChanged = changedPaths.map((p) => normalizePath(p))

  for (const p of normalizedChanged) {
    const base = ospath.basename(p)
    if (base === 'antora.yml' || base === 'antora.yaml' || base.endsWith('playbook.yml') || base.endsWith('playbook.yaml')) {
      forceFull = true
      reasons[p] = 'playbook-or-component-descriptor'
      continue
    }
    if (/\.(css|js|hbs)$/i.test(p) && /ui|supplemental/i.test(p)) {
      forceFull = true
      reasons[p] = 'ui-change'
      continue
    }
  }

  if (forceFull) {
    return {
      pages: Object.keys(manifest.pages || {}),
      navDirty: true,
      aliasDirty: true,
      searchDirty: true,
      forceFull: true,
      reasons,
    }
  }

  // Direct page path hits
  for (const [id, meta] of Object.entries(manifest.pages || {})) {
    for (const changed of normalizedChanged) {
      if (pathMatchesMeta(changed, meta)) {
        pages.add(id)
        reasons[id] = reasons[id] || []
        reasons[id].push(`path:${changed}`)
      }
    }
  }

  // Nav file hits → all pages in that nav's component-version
  for (const [nid, nmeta] of Object.entries(manifest.nav || {})) {
    for (const changed of normalizedChanged) {
      if (pathMatchesMeta(changed, nmeta)) {
        navDirty = true
        for (const pid of nmeta.pages || []) {
          pages.add(pid)
          reasons[pid] = reasons[pid] || []
          reasons[pid].push(`nav:${nid}`)
        }
      }
    }
  }

  // Include reverse edges: changed path looks like an include target
  for (const changed of normalizedChanged) {
    const changedBase = ospath.basename(changed)
    for (const [key, includers] of Object.entries(manifest.partialToIncluders || {})) {
      if (includeKeyMatchesPath(key, changed)) {
        for (const id of includers) {
          pages.add(id)
          reasons[id] = reasons[id] || []
          reasons[id].push(`include:${key}`)
        }
      }
    }
    for (const [id, meta] of Object.entries(manifest.pages || {})) {
      for (const inc of meta.includes || []) {
        const incBase = ospath.basename(String(inc).replace(/^partial\$/, ''))
        if (incBase && (changedBase === incBase || changed.endsWith('/partials/' + incBase))) {
          pages.add(id)
          reasons[id] = reasons[id] || []
          reasons[id].push(`include-listed:${inc}`)
        }
      }
    }
  }

  // Xref: if a page changed, referrers may need title/href refresh
  const directlyDirty = [...pages]
  for (const id of directlyDirty) {
    const referrers = manifest.xrefTargetToReferrers?.[id] || []
    // Also match by relative path suffix in xref keys
    const meta = manifest.pages[id]
    for (const [xrefKey, refs] of Object.entries(manifest.xrefTargetToReferrers || {})) {
      if (xrefKey === id || (meta && xrefKeyEndsWithPage(xrefKey, meta))) {
        for (const r of refs) {
          pages.add(r)
          reasons[r] = reasons[r] || []
          reasons[r].push(`xref-from:${id}`)
        }
      }
    }
    for (const r of referrers) {
      pages.add(r)
      reasons[r] = reasons[r] || []
      reasons[r].push(`xref-from:${id}`)
    }
  }

  // Alias descriptor changes
  for (const [aid, ameta] of Object.entries(manifest.aliases || {})) {
    for (const changed of normalizedChanged) {
      if (pathMatchesMeta(changed, ameta)) {
        aliasDirty = true
        if (ameta.target) pages.add(ameta.target)
        reasons[aid] = 'alias-path'
      }
    }
  }

  const pageList = [...pages]
  return {
    pages: pageList,
    navDirty,
    aliasDirty,
    searchDirty: pageList.length > 0 || navDirty || aliasDirty,
    forceFull: false,
    reasons,
  }
}

function normalizePath (p) {
  return String(p).replace(/\\/g, '/')
}

function pathMatchesMeta (changed, meta) {
  if (!meta) return false
  const c = normalizePath(changed)
  if (meta.abspath && normalizePath(meta.abspath) === c) return true
  if (meta.path && (c.endsWith('/' + normalizePath(meta.path)) || c.endsWith(normalizePath(meta.path)))) return true
  return false
}

function includeKeyMatchesPath (key, changedPath) {
  const c = normalizePath(changedPath)
  const parts = key.split('::')
  // key: origin::startPath::includeTarget::from:rel
  const includeTarget = (parts[2] || '').replace(/^\/+/, '')
  if (!includeTarget) return false
  let target = includeTarget.replace(/^partial\$/, 'partials/').replace(/\\/g, '/')
  if (target.startsWith('partials/') === false && /partials\//.test(c)) {
    // bare filename include of a partial
    target = ospath.basename(target)
  }
  const base = ospath.basename(target.replace(/^partials\//, ''))
  return (
    c.endsWith('/' + target) ||
    c.endsWith(target) ||
    c.endsWith('/partials/' + base) ||
    c.endsWith('\\partials\\' + base)
  )
}

function xrefKeyEndsWithPage (xrefKey, meta) {
  if (!meta?.path) return false
  const rel = normalizePath(meta.path)
  return xrefKey.endsWith(rel) || xrefKey.endsWith(ospath.basename(rel))
}

function loadManifest (filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

module.exports = { computeDirtySet, loadManifest, pathMatchesMeta }
