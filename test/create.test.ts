import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createProject } from '../src/create.js'
import type { TemplateName } from '../src/create.js'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'hs-create-'))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

async function listFiles(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory()) {
      files.push(...(await listFiles(join(dir, e.name), rel)))
    } else {
      files.push(rel)
    }
  }
  return files.sort()
}

describe('createProject', () => {
  const SHARED_FILES = [
    '.gitignore',
    'README.md',
    'hyperstache.config.ts',
    'package.json',
    'src/lib/utils.lua',
    'src/process.lua',
    'src/templates/index.html',
  ]

  describe('basic template', () => {
    it('creates expected files', async () => {
      await createProject('my-app', 'basic', tmp)
      const files = await listFiles(join(tmp, 'my-app'))
      expect(files).toEqual(SHARED_FILES)
    })

    it('does not include vite in devDependencies', async () => {
      await createProject('my-app', 'basic', tmp)
      const pkg = JSON.parse(await readFile(join(tmp, 'my-app/package.json'), 'utf-8'))
      expect(pkg.devDependencies.vite).toBeUndefined()
      expect(pkg.scripts.dev).toBeUndefined()
    })

    it('config has no templates.vite', async () => {
      await createProject('my-app', 'basic', tmp)
      const config = await readFile(join(tmp, 'my-app/hyperstache.config.ts'), 'utf-8')
      expect(config).not.toContain('vite')
    })
  })

  describe('vite template', () => {
    it('creates expected files', async () => {
      await createProject('my-app', 'vite', tmp)
      const files = await listFiles(join(tmp, 'my-app'))
      expect(files).toEqual([...SHARED_FILES, 'src/templates/styles.css'].sort())
    })

    it('includes vite in devDependencies and dev script', async () => {
      await createProject('my-app', 'vite', tmp)
      const pkg = JSON.parse(await readFile(join(tmp, 'my-app/package.json'), 'utf-8'))
      expect(pkg.devDependencies.vite).toBeDefined()
      expect(pkg.scripts.dev).toBe('hyperstache dev')
    })

    it('config enables templates.vite', async () => {
      await createProject('my-app', 'vite', tmp)
      const config = await readFile(join(tmp, 'my-app/hyperstache.config.ts'), 'utf-8')
      expect(config).toContain('vite: true')
    })
  })

  describe('typescript template', () => {
    it('creates expected files', async () => {
      await createProject('my-app', 'typescript', tmp)
      const files = await listFiles(join(tmp, 'my-app'))
      expect(files).toContain('tsconfig.json')
      expect(files).toContain('src/templates/app.ts')
      expect(files).toContain('src/templates/styles.css')
    })

    it('includes typescript in devDependencies', async () => {
      await createProject('my-app', 'typescript', tmp)
      const pkg = JSON.parse(await readFile(join(tmp, 'my-app/package.json'), 'utf-8'))
      expect(pkg.devDependencies.typescript).toBeDefined()
      expect(pkg.devDependencies.vite).toBeDefined()
    })

    it('html references app.ts', async () => {
      await createProject('my-app', 'typescript', tmp)
      const html = await readFile(join(tmp, 'my-app/src/templates/index.html'), 'utf-8')
      expect(html).toContain('app.ts')
    })
  })

  describe('tailwind template', () => {
    it('creates expected files', async () => {
      await createProject('my-app', 'tailwind', tmp)
      const files = await listFiles(join(tmp, 'my-app'))
      expect(files).toContain('src/templates/styles.css')
    })

    it('includes tailwind packages in devDependencies', async () => {
      await createProject('my-app', 'tailwind', tmp)
      const pkg = JSON.parse(await readFile(join(tmp, 'my-app/package.json'), 'utf-8'))
      expect(pkg.devDependencies.tailwindcss).toBeDefined()
      expect(pkg.devDependencies['@tailwindcss/vite']).toBeDefined()
    })

    it('styles.css imports tailwindcss', async () => {
      await createProject('my-app', 'tailwind', tmp)
      const css = await readFile(join(tmp, 'my-app/src/templates/styles.css'), 'utf-8')
      expect(css).toContain('@import "tailwindcss"')
    })

    it('config uses @tailwindcss/vite plugin', async () => {
      await createProject('my-app', 'tailwind', tmp)
      const config = await readFile(join(tmp, 'my-app/hyperstache.config.ts'), 'utf-8')
      expect(config).toContain('@tailwindcss/vite')
    })

    it('html uses tailwind classes', async () => {
      await createProject('my-app', 'tailwind', tmp)
      const html = await readFile(join(tmp, 'my-app/src/templates/index.html'), 'utf-8')
      expect(html).toContain('class=')
    })
  })

  describe('validation', () => {
    it('rejects invalid project names', async () => {
      await expect(createProject('My App!', 'basic', tmp)).rejects.toThrow('Invalid project name')
    })

    it('rejects uppercase names', async () => {
      await expect(createProject('MyApp', 'basic', tmp)).rejects.toThrow('Invalid project name')
    })

    it('rejects empty names', async () => {
      await expect(createProject('', 'basic', tmp)).rejects.toThrow('Invalid project name')
    })

    it('throws when directory already exists', async () => {
      await createProject('my-app', 'basic', tmp)
      await expect(createProject('my-app', 'basic', tmp)).rejects.toThrow('already exists')
    })
  })

  describe('common properties', () => {
    const templates: TemplateName[] = ['basic', 'vite', 'typescript', 'tailwind']

    for (const template of templates) {
      it(`${template}: package.json has correct name and type`, async () => {
        await createProject('test-proj', template, tmp)
        const pkg = JSON.parse(await readFile(join(tmp, 'test-proj/package.json'), 'utf-8'))
        expect(pkg.name).toBe('test-proj')
        expect(pkg.type).toBe('module')
        expect(pkg.private).toBe(true)
      })

      it(`${template}: config includes lustache dependency`, async () => {
        await createProject('test-proj', template, tmp)
        const config = await readFile(join(tmp, 'test-proj/hyperstache.config.ts'), 'utf-8')
        expect(config).toContain('lustache')
      })

      it(`${template}: .gitignore includes node_modules and dist`, async () => {
        await createProject('test-proj', template, tmp)
        const gi = await readFile(join(tmp, 'test-proj/.gitignore'), 'utf-8')
        expect(gi).toContain('node_modules')
        expect(gi).toContain('dist')
      })
    }
  })
})
