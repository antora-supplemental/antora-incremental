'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { scanAsciiDocDeps } = require('../lib/scan.js')
const { computeDirtySet } = require('../lib/dirty.js')

describe('scanAsciiDocDeps', () => {
  it('finds includes, xrefs, aliases', () => {
    const text = `= Title
:page-aliases: old-name.adoc

include::partial$shared.adoc[]

See xref:other-page.adoc[Other] and xref:comp:1.0:ROOT:x.adoc#frag[X].
`
    const d = scanAsciiDocDeps(text)
    assert.deepEqual(d.includes, ['partial$shared.adoc'])
    assert.ok(d.xrefs.includes('other-page.adoc'))
    assert.ok(d.xrefs.some((x) => x.includes('comp:1.0:ROOT:x.adoc')))
    assert.deepEqual(d.aliases, ['old-name.adoc'])
  })
})

describe('computeDirtySet', () => {
  const manifest = {
    pages: {
      'demo:1.0:ROOT:index.adoc': {
        path: 'modules/ROOT/pages/index.adoc',
        abspath: '/repo/docs/modules/ROOT/pages/index.adoc',
        includes: ['partial$note.adoc'],
        xrefs: [],
        aliases: [],
        component: 'demo',
        version: '1.0',
      },
      'demo:1.0:ROOT:guide.adoc': {
        path: 'modules/ROOT/pages/guide.adoc',
        abspath: '/repo/docs/modules/ROOT/pages/guide.adoc',
        includes: [],
        xrefs: ['demo:1.0:ROOT:index.adoc'],
        aliases: [],
        component: 'demo',
        version: '1.0',
      },
    },
    nav: {
      'nav:demo:1.0:ROOT:nav.adoc': {
        path: 'modules/ROOT/nav.adoc',
        abspath: '/repo/docs/modules/ROOT/nav.adoc',
        pages: ['demo:1.0:ROOT:index.adoc', 'demo:1.0:ROOT:guide.adoc'],
      },
    },
    aliases: {},
    partialToIncluders: {
      ':::/partial$note.adoc::from:modules/ROOT/pages/index.adoc': ['demo:1.0:ROOT:index.adoc'],
    },
    xrefTargetToReferrers: {
      'demo:1.0:ROOT:index.adoc': ['demo:1.0:ROOT:guide.adoc'],
    },
  }

  it('marks page dirty when its path changes', () => {
    const r = computeDirtySet(manifest, ['/repo/docs/modules/ROOT/pages/index.adoc'])
    assert.ok(r.pages.includes('demo:1.0:ROOT:index.adoc'))
    assert.ok(r.pages.includes('demo:1.0:ROOT:guide.adoc'), 'xref referrer dirty')
    assert.equal(r.forceFull, false)
  })

  it('marks component pages dirty when nav changes', () => {
    const r = computeDirtySet(manifest, ['/repo/docs/modules/ROOT/nav.adoc'])
    assert.equal(r.navDirty, true)
    assert.ok(r.pages.includes('demo:1.0:ROOT:index.adoc'))
    assert.ok(r.pages.includes('demo:1.0:ROOT:guide.adoc'))
  })

  it('forceFull on antora.yml', () => {
    const r = computeDirtySet(manifest, ['/repo/docs/antora.yml'])
    assert.equal(r.forceFull, true)
    assert.ok(r.pages.length >= 2)
  })

  it('include change dirties includers via partial key basename', () => {
    const r = computeDirtySet(manifest, ['/repo/docs/modules/ROOT/partials/note.adoc'])
    assert.ok(r.pages.includes('demo:1.0:ROOT:index.adoc'))
  })
})
