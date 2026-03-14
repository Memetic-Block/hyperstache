import { describe, it, expect, afterEach } from 'vitest'
import { escapeTemplateSyntax, restoreTemplateSyntax, renderTemplates } from '../src/bundler/vite-render.js'
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
      { entry: 'src/process.lua' },
      fixtureRoot,
    )
    // vite defaults to false
    expect(config.templates.vite).toBe(false)

    const { entries } = await collectTemplates(config)
    const result = await renderTemplates(entries, config)

    // Should return entries unchanged
    expect(result).toEqual(entries)
  })

  it('processes templates through Vite when enabled', async () => {
    const config = await resolveConfig(
      {
        entry: 'src/process.lua',
        templates: { vite: true },
      },
      fixtureRoot,
    )

    const { entries } = await collectTemplates(config)
    const result = await renderTemplates(entries, config)

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
        entry: 'src/process.lua',
        templates: { vite: true },
      },
      fixtureRoot,
    )

    const { entries } = await collectTemplates(config)
    const result = await renderTemplates(entries, config)

    const profile = result.find((e) => e.key === 'profile.htm')
    expect(profile).toBeDefined()

    // Remote URL should be preserved
    expect(profile!.content).toContain('https://cdn.example.com/external.css')

    // Mustache expressions should be preserved
    expect(profile!.content).toContain('{{username}}')
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
        entry: 'src/process.lua',
        outDir: 'dist',
        templates: { vite: true },
      },
      fixtureRoot,
    )

    const result = await bundle(config)

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
  })
})
