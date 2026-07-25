'use strict'

/**
 * Lightweight AsciiDoc dependency scan (not a full parser).
 * Good enough for dirty-set v1 of the manifest.
 */
function scanAsciiDocDeps (text) {
  const includes = []
  const xrefs = []
  const aliases = []
  if (!text) return { includes, xrefs, aliases }

  const includeRe = /^include::([^\[]+)\[/gm
  let m
  while ((m = includeRe.exec(text))) {
    includes.push(m[1].trim())
  }

  const xrefRe = /xref:([^\[]+)\[/g
  while ((m = xrefRe.exec(text))) {
    xrefs.push(normalizeXrefTarget(m[1].trim()))
  }

  const aliasRe = /^:page-aliases?:\s*(.+)$/m
  const aliasMatch = text.match(aliasRe)
  if (aliasMatch) {
    for (const part of aliasMatch[1].split(/[;,]/)) {
      const a = part.trim()
      if (a) aliases.push(a)
    }
  }

  return { includes, xrefs, aliases }
}

function normalizeXrefTarget (raw) {
  // strip fragment
  return raw.split('#')[0].replace(/\.adoc$/i, '.adoc')
}

module.exports = { scanAsciiDocDeps, normalizeXrefTarget }
