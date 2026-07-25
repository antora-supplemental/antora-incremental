'use strict'

function pageId (file) {
  if (!file?.src) return null
  const { component, version, module: mod, relative, family } = file.src
  if (family && family !== 'page' && family !== 'alias') {
    // still allow page-like
  }
  if (!component || relative == null) return null
  const moduleName = mod || 'ROOT'
  const ver = version == null || version === '' ? 'master' : version
  return `${component}:${ver}:${moduleName}:${relative}`
}

function resourceId (file) {
  if (!file?.src) return null
  const { component, version, module: mod, relative, family } = file.src
  if (!component || relative == null) return null
  const moduleName = mod || 'ROOT'
  const ver = version == null || version === '' ? 'master' : version
  const fam = family || 'resource'
  return `${fam}:${component}:${ver}:${moduleName}:${relative}`
}

module.exports = { pageId, resourceId }
