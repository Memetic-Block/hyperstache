import { describe, it, expect, afterEach } from 'vitest'
import { escapeTemplateSyntax, restoreTemplateSyntax, renderTemplates, parseExternals, resolveExternalUrl, escapeInlineScripts, restoreInlineScripts } from '../src/bundler/vite-render.js'
import { resolveConfig } from '../src/config.js'
import { collectTemplates } from '../src/bundler/templates.js'
import { bundle } from '../src/bundler/index.js'
import { resolve } from 'node:path'
import { rm } from 'node:fs/promises'

// ---------------------------------------------------------------------------
// Unit: escapeTemplateSyntax / restoreTemplateSyntax
// ---------------------------------------------------------------------------

describe('escapeTemplateSyntax', () => {
  it('escapes double-brace variables', () => {
    const { escaped, markers } = escapeTemplateSyntax('<p>{{name}}</p>')
    expect(escaped).not.toContain('{{')
    expect(escaped).toContain('<!--HS_MARKER_0-->')
    expect(markers.get(0)).toBe('{{name}}')
  })

  it('escapes triple-brace (unescaped) variables', () => {
    const { escaped, markers } = escapeTemplateSyntax('<p>{{{rawHtml}}}</p>')
    expect(escaped).not.toContain('{{{')
    expect(markers.get(0)).toBe('{{{rawHtml}}}')
  })

  it('escapes section tags', () => {
    const html = '{{#items}}<li>{{name}}</li>{{/items}}'
    const { escaped, markers } = escapeTemplateSyntax(html)
    expect(escaped).not.toContain('{{')
    expect(markers.size).toBe(3)
    expect(markers.get(0)).toBe('{{#items}}')
    expect(markers.get(1)).toBe('{{name}}')
    expect(markers.get(2)).toBe('{{/items}}')
  })

  it('escapes partial tags', () => {
    const { markers } = escapeTemplateSyntax('{{> header}}')
    expect(markers.get(0)).toBe('{{> header}}')
  })

  it('escapes comment tags', () => {
    const { markers } = escapeTemplateSyntax('{{! this is a comment }}')
    expect(markers.get(0)).toBe('{{! this is a comment }}')
  })

  it('handles multiple expressions on the same line', () => {
    const html = '<p>{{first}} {{last}}</p>'
    const { markers } = escapeTemplateSyntax(html)
    expect(markers.size).toBe(2)
  })

  it('handles multiline templates', () => {
    const html = `<div>
  <h1>{{title}}</h1>
  <p>{{body}}</p>
</div>`
    const { escaped, markers } = escapeTemplateSyntax(html)
    expect(markers.size).toBe(2)
    expect(escaped).toContain('<!--HS_MARKER_0-->')
    expect(escaped).toContain('<!--HS_MARKER_1-->')
  })
})

describe('restoreTemplateSyntax', () => {
  it('round-trips through escape and restore', () => {
    const original = '<h1>{{title}}</h1><p>{{{content}}}</p>{{#show}}<span>{{msg}}</span>{{/show}}'
    const { escaped, markers } = escapeTemplateSyntax(original)
    const restored = restoreTemplateSyntax(escaped, markers)
    expect(restored).toBe(original)
  })

  it('handles empty input', () => {
    const { escaped, markers } = escapeTemplateSyntax('')
    expect(restoreTemplateSyntax(escaped, markers)).toBe('')
  })

  it('handles input with no mustache expressions', () => {
    const html = '<p>Hello World</p>'
    const { escaped, markers } = escapeTemplateSyntax(html)
    expect(escaped).toBe(html)
    expect(markers.size).toBe(0)
    expect(restoreTemplateSyntax(escaped, markers)).toBe(html)
  })
})

// ---------------------------------------------------------------------------
// Integration: renderTemplates
// ---------------------------------------------------------------------------

describe('renderTemplates', () => {
  const fixtureRoot = resolve(__dirname, 'fixtures/vite-app')

  it('passes through when vite is disabled', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
        },
      },
      fixtureRoot,
    )
    const proc = config.processes[0]
    // vite defaults to false
    expect(proc.templates.vite).toBe(false)

    const { entries } = await collectTemplates(proc)
    const result = await renderTemplates(entries, proc)

    // Should return entries unchanged
    expect(result).toEqual(entries)
  })

  it('processes templates through Vite when enabled', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
        },
        templates: { vite: true },
      },
      fixtureRoot,
    )
    const proc = config.processes[0]

    const { entries } = await collectTemplates(proc)
    const result = await renderTemplates(entries, proc)

    // Should still have the same number of templates
    expect(result.length).toBe(entries.length)

    // Find index.html in results
    const indexHtml = result.find((e) => e.key === 'index.html')
    expect(indexHtml).toBeDefined()

    // CSS should be inlined as <style> tag
    expect(indexHtml!.content).toContain('<style>')
    expect(indexHtml!.content).toContain('font-family')

    // JS should be inlined as <script> tag (no more src attribute to app.ts)
    expect(indexHtml!.content).toMatch(/<script[\s>]/)
    expect(indexHtml!.content).toContain('greeting')
    expect(indexHtml!.content).not.toContain('src="./app.ts"')

    // Mustache expressions should be preserved
    expect(indexHtml!.content).toContain('{{title}}')
    expect(indexHtml!.content).toContain('{{name}}')
  })

  it('preserves remote URLs', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
        },
        templates: { vite: true },
      },
      fixtureRoot,
    )
    const proc = config.processes[0]

    const { entries } = await collectTemplates(proc)
    const result = await renderTemplates(entries, proc)

    const profile = result.find((e) => e.key === 'profile.htm')
    expect(profile).toBeDefined()

    // Remote URL should be preserved
    expect(profile!.content).toContain('https://cdn.example.com/external.css')

    // Mustache expressions should be preserved
    expect(profile!.content).toContain('{{username}}')
  })
})

// ---------------------------------------------------------------------------
// Unit: escapeInlineScripts / restoreInlineScripts
// ---------------------------------------------------------------------------

describe('escapeInlineScripts', () => {
  it('escapes inline script with content', () => {
    const html = '<script type="module">globalThis.process={browser:!0,env:{}}</script>'
    const { escaped, markers } = escapeInlineScripts(html)
    expect(escaped).toContain('<!--HS_INLINE_SCRIPT_0-->')
    expect(markers.get(0)).toBe(html)
  })

  it('does not escape script tags with src attribute', () => {
    const html = '<script type="module" src="./app.ts"></script>'
    const { escaped, markers } = escapeInlineScripts(html)
    expect(escaped).toBe(html)
    expect(markers.size).toBe(0)
  })

  it('escapes multiple inline scripts', () => {
    const html = '<script>var a=1</script><script type="module" src="./x.ts"></script><script>var b=2</script>'
    const { escaped, markers } = escapeInlineScripts(html)
    expect(markers.size).toBe(2)
    expect(markers.get(0)).toBe('<script>var a=1</script>')
    expect(markers.get(1)).toBe('<script>var b=2</script>')
    expect(escaped).toContain('src="./x.ts"')
  })

  it('round-trips through escape and restore', () => {
    const original = '<head>\n<script crossorigin type="module">globalThis.process={browser:!0,env:{}}</script>\n<script type="module" src="./app.ts"></script>\n</head>'
    const { escaped, markers } = escapeInlineScripts(original)
    const restored = restoreInlineScripts(escaped, markers)
    expect(restored).toBe(original)
  })
})

// ---------------------------------------------------------------------------
// Integration: renderTemplates with esm
// ---------------------------------------------------------------------------

describe('renderTemplates with esm', () => {
  const fixtureRoot = resolve(__dirname, 'fixtures/vite-app')

  it('preserves type="module" on inlined scripts when esm is true', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
        },
        templates: { vite: { esm: true } },
      },
      fixtureRoot,
    )
    const proc = config.processes[0]

    const { entries } = await collectTemplates(proc)
    const result = await renderTemplates(entries, proc)

    const indexHtml = result.find((e) => e.key === 'index.html')
    expect(indexHtml).toBeDefined()

    // JS should be inlined with type="module" preserved
    expect(indexHtml!.content).toContain('greeting')
    expect(indexHtml!.content).not.toContain('src="./app.ts"')
    expect(indexHtml!.content).toMatch(/<script[^>]*type=["']module["'][^>]*>/)

    // Pre-existing inline script should be preserved exactly
    expect(indexHtml!.content).toContain('globalThis.process={browser:!0,env:{}}')
    expect(indexHtml!.content).toContain('<script crossorigin type="module">globalThis.process={browser:!0,env:{}}</script>')

    // Mustache expressions should be preserved
    expect(indexHtml!.content).toContain('{{title}}')
    expect(indexHtml!.content).toContain('{{name}}')
  })

  it('strips type="module" when esm is not set (backward compat)', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
        },
        templates: { vite: true },
      },
      fixtureRoot,
    )
    const proc = config.processes[0]

    const { entries } = await collectTemplates(proc)
    const result = await renderTemplates(entries, proc)

    const indexHtml = result.find((e) => e.key === 'index.html')
    expect(indexHtml).toBeDefined()

    // The inlined app.ts script should NOT have type="module"
    // Find the script tag that contains the greeting code (the inlined one)
    const greetingScriptMatch = indexHtml!.content.match(/<script[^>]*>[\s\S]*?greeting[\s\S]*?<\/script>/i)
    expect(greetingScriptMatch).toBeDefined()
    expect(greetingScriptMatch![0]).not.toMatch(/type=["']module["']/)
  })
})

// ---------------------------------------------------------------------------
// Integration: renderTemplates with externals
// ---------------------------------------------------------------------------

describe('renderTemplates with externals', () => {
  const fixtureRoot = resolve(__dirname, 'fixtures/vite-app')

  it('keeps external CSS as <link> instead of inlining', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
        },
        templates: { vite: { external: ['./styles.css'] } },
      },
      fixtureRoot,
    )
    const proc = config.processes[0]

    const { entries } = await collectTemplates(proc)
    const result = await renderTemplates(entries, proc)

    const indexHtml = result.find((e) => e.key === 'index.html')
    expect(indexHtml).toBeDefined()

    // CSS should NOT be inlined — external means Rollup leaves it alone
    expect(indexHtml!.content).not.toContain('<style>')
    // Mustache expressions should still be preserved
    expect(indexHtml!.content).toContain('{{title}}')
  })

  it('threads external config through resolveConfig', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
        },
        templates: { vite: { external: ['lodash', /^@scope\//] } },
      },
      fixtureRoot,
    )
    const proc = config.processes[0]
    const viteOpts = proc.templates.vite
    expect(viteOpts).not.toBe(false)
    if (viteOpts !== false) {
      expect(viteOpts.external).toHaveLength(2)
      expect(viteOpts.external![0]).toBe('lodash')
      expect(viteOpts.external![1]).toBeInstanceOf(RegExp)
    }
  })

  it('handles vite: true without external', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
        },
        templates: { vite: true },
      },
      fixtureRoot,
    )
    const proc = config.processes[0]
    const viteOpts = proc.templates.vite
    expect(viteOpts).not.toBe(false)
    if (viteOpts !== false) {
      expect(viteOpts.external).toBeUndefined()
    }
  })
})

// ---------------------------------------------------------------------------
// Integration: full bundle with Vite templates
// ---------------------------------------------------------------------------

describe('bundle with vite templates', () => {
  const fixtureRoot = resolve(__dirname, 'fixtures/vite-app')
  const outDir = resolve(fixtureRoot, 'dist')

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true }).catch(() => {})
  })

  it('bundles with Vite-processed templates', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
        },
        outDir: 'dist',
        templates: { vite: true },
      },
      fixtureRoot,
    )

    const results = await bundle(config)
    expect(results).toHaveLength(1)
    const result = results[0]

    expect(result.viteProcessed).toBe(true)
    expect(result.templateCount).toBe(2)
    expect(result.moduleCount).toBe(1)

    // Output should contain inlined CSS in the templates
    expect(result.output).toContain('font-family')
    // Mustache expressions preserved through the entire pipeline
    expect(result.output).toContain('{{title}}')
    expect(result.output).toContain('{{username}}')
    // Module loader present
    expect(result.output).toContain('local _modules = {}')
    // No externals configured
    expect(result.viteExternals).toEqual([])
  })

  it('reports viteExternals in BundleResult', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
        },
        outDir: 'dist',
        templates: { vite: { external: ['./styles.css'] } },
      },
      fixtureRoot,
    )

    const results = await bundle(config)
    expect(results).toHaveLength(1)
    const result = results[0]

    expect(result.viteExternals).toEqual(['./styles.css'])
    expect(result.viteProcessed).toBe(true)
  })

  it('reports ExternalDep names in viteExternals', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
        },
        outDir: 'dist',
        templates: { vite: { external: [{ name: 'htmx', url: 'https://cdn.example.com/htmx.esm.js' }] } },
      },
      fixtureRoot,
    )

    const results = await bundle(config)
    const result = results[0]

    expect(result.viteExternals).toEqual(['htmx'])
    expect(result.viteProcessed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Unit: resolveExternalUrl
// ---------------------------------------------------------------------------

describe('resolveExternalUrl', () => {
  it('passes through normal https URLs', () => {
    expect(resolveExternalUrl('https://cdn.example.com/lib.js')).toBe('https://cdn.example.com/lib.js')
  })

  it('passes through http URLs', () => {
    expect(resolveExternalUrl('http://localhost:3000/lib.js')).toBe('http://localhost:3000/lib.js')
  })

  it('transforms ar:// to relative path', () => {
    expect(resolveExternalUrl('ar://abc123txid')).toBe('/abc123txid')
  })

  it('handles ar:// with long txid', () => {
    const txid = 'xYz_1234567890abcdefABCDEF-GHIJKLMNOPQRSTUV'
    expect(resolveExternalUrl(`ar://${txid}`)).toBe(`/${txid}`)
  })
})

// ---------------------------------------------------------------------------
// Unit: parseExternals
// ---------------------------------------------------------------------------

describe('parseExternals', () => {
  it('returns empty for undefined', () => {
    const { rollupExternals, importMap } = parseExternals(undefined)
    expect(rollupExternals).toEqual([])
    expect(importMap).toEqual({})
  })

  it('passes plain strings through as Rollup externals only', () => {
    const { rollupExternals, importMap } = parseExternals(['lodash', 'react'])
    expect(rollupExternals).toEqual(['lodash', 'react'])
    expect(importMap).toEqual({})
  })

  it('passes RegExp entries through as Rollup externals only', () => {
    const re = /^@scope\//
    const { rollupExternals, importMap } = parseExternals([re])
    expect(rollupExternals).toEqual([re])
    expect(importMap).toEqual({})
  })

  it('splits ExternalDep objects into both Rollup externals and import map', () => {
    const { rollupExternals, importMap } = parseExternals([
      { name: 'htmx', url: 'https://cdn.example.com/htmx.esm.js' },
    ])
    expect(rollupExternals).toEqual(['htmx'])
    expect(importMap).toEqual({ htmx: 'https://cdn.example.com/htmx.esm.js' })
  })

  it('resolves ar:// URLs in import map entries', () => {
    const { rollupExternals, importMap } = parseExternals([
      { name: 'alpine', url: 'ar://abc123' },
    ])
    expect(rollupExternals).toEqual(['alpine'])
    expect(importMap).toEqual({ alpine: '/abc123' })
  })

  it('handles mixed array of strings, RegExps, and ExternalDep objects', () => {
    const { rollupExternals, importMap } = parseExternals([
      'lodash',
      /^@scope\//,
      { name: 'htmx', url: 'https://cdn.example.com/htmx.esm.js' },
      { name: 'alpine', url: 'ar://abc123' },
    ])
    expect(rollupExternals).toEqual(['lodash', /^@scope\//, 'htmx', 'alpine'])
    expect(importMap).toEqual({
      htmx: 'https://cdn.example.com/htmx.esm.js',
      alpine: '/abc123',
    })
  })
})

// ---------------------------------------------------------------------------
// Integration: import map injection
// ---------------------------------------------------------------------------

describe('renderTemplates with import map', () => {
  const fixtureRoot = resolve(__dirname, 'fixtures/vite-app')

  it('injects import map for ExternalDep entries', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
        },
        templates: {
          vite: {
            external: [
              { name: 'htmx', url: 'https://cdn.example.com/htmx.esm.js' },
            ],
          },
        },
      },
      fixtureRoot,
    )
    const proc = config.processes[0]

    const { entries } = await collectTemplates(proc)
    const result = await renderTemplates(entries, proc)

    const indexHtml = result.find((e) => e.key === 'index.html')
    expect(indexHtml).toBeDefined()

    // Should contain an import map
    expect(indexHtml!.content).toContain('<script type="importmap">')
    expect(indexHtml!.content).toContain('"htmx": "https://cdn.example.com/htmx.esm.js"')

    // Mustache expressions still preserved
    expect(indexHtml!.content).toContain('{{title}}')
  })

  it('resolves ar:// URLs to relative paths in import map', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
        },
        templates: {
          vite: {
            external: [
              { name: 'alpine', url: 'ar://abc123txid' },
            ],
          },
        },
      },
      fixtureRoot,
    )
    const proc = config.processes[0]

    const { entries } = await collectTemplates(proc)
    const result = await renderTemplates(entries, proc)

    const indexHtml = result.find((e) => e.key === 'index.html')
    expect(indexHtml).toBeDefined()

    expect(indexHtml!.content).toContain('<script type="importmap">')
    expect(indexHtml!.content).toContain('"alpine": "/abc123txid"')
  })

  it('does not inject import map for plain string externals', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
        },
        templates: { vite: { external: ['./styles.css'] } },
      },
      fixtureRoot,
    )
    const proc = config.processes[0]

    const { entries } = await collectTemplates(proc)
    const result = await renderTemplates(entries, proc)

    const indexHtml = result.find((e) => e.key === 'index.html')
    expect(indexHtml).toBeDefined()

    // No import map — plain external has no URL
    expect(indexHtml!.content).not.toContain('<script type="importmap">')
  })

  it('handles mixed externals: plain + ExternalDep', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
        },
        templates: {
          vite: {
            external: [
              './styles.css',
              { name: 'htmx', url: 'https://cdn.example.com/htmx.esm.js' },
            ],
          },
        },
      },
      fixtureRoot,
    )
    const proc = config.processes[0]

    const { entries } = await collectTemplates(proc)
    const result = await renderTemplates(entries, proc)

    const indexHtml = result.find((e) => e.key === 'index.html')
    expect(indexHtml).toBeDefined()

    // Import map for the ExternalDep
    expect(indexHtml!.content).toContain('<script type="importmap">')
    expect(indexHtml!.content).toContain('"htmx"')

    // CSS still externalized (not inlined)
    expect(indexHtml!.content).not.toContain('<style>')

    // Mustache preserved
    expect(indexHtml!.content).toContain('{{title}}')
  })

  it('import map appears before module scripts in <head>', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
        },
        templates: {
          vite: {
            external: [
              { name: 'htmx', url: 'https://cdn.example.com/htmx.esm.js' },
            ],
          },
        },
      },
      fixtureRoot,
    )
    const proc = config.processes[0]

    const { entries } = await collectTemplates(proc)
    const result = await renderTemplates(entries, proc)

    const indexHtml = result.find((e) => e.key === 'index.html')
    expect(indexHtml).toBeDefined()

    const html = indexHtml!.content
    const importMapIdx = html.indexOf('<script type="importmap">')
    const headIdx = html.indexOf('<head')
    expect(importMapIdx).toBeGreaterThan(headIdx)

    // If there's a module script, import map must come before it
    const moduleScriptIdx = html.indexOf('<script type="module"')
    if (moduleScriptIdx !== -1) {
      expect(importMapIdx).toBeLessThan(moduleScriptIdx)
    }
  })
})
