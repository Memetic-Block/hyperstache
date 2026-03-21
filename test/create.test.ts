import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createProject, printNextSteps } from '../src/create.js'
import type { CreateFlags } from '../src/create.js'

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
  const BASE_FILES = [
    '.env.example',
    '.gitignore',
    'README.md',
    'hyperstache.config.ts',
    'package.json',
    'src/lib/utils.lua',
    'src/process.lua',
    'src/templates/app.js',
    'src/templates/index.html',
    'src/templates/styles.css',
  ]

  describe('no flags (default)', () => {
    it('creates expected files', async () => {
      await createProject('my-app', {}, tmp)
      const files = await listFiles(join(tmp, 'my-app'))
      expect(files).toEqual(BASE_FILES)
    })

    it('includes vite in devDependencies and dev script', async () => {
      await createProject('my-app', {}, tmp)
      const pkg = JSON.parse(await readFile(join(tmp, 'my-app/package.json'), 'utf-8'))
      expect(pkg.devDependencies.vite).toBeDefined()
      expect(pkg.scripts.dev).toBe('hyperstache dev')
    })

    it('includes luarocks-install script', async () => {
      await createProject('my-app', {}, tmp)
      const pkg = JSON.parse(await readFile(join(tmp, 'my-app/package.json'), 'utf-8'))
      expect(pkg.scripts['luarocks-install']).toBe(
        'hyperstache rockspec && luarocks make --only-deps --tree lua_modules *.rockspec',
      )
    })

    it('config enables templates.vite', async () => {
      await createProject('my-app', {}, tmp)
      const config = await readFile(join(tmp, 'my-app/hyperstache.config.ts'), 'utf-8')
      expect(config).toContain('vite: true')
    })

    it('config does not contain esm', async () => {
      await createProject('my-app', {}, tmp)
      const config = await readFile(join(tmp, 'my-app/hyperstache.config.ts'), 'utf-8')
      expect(config).not.toContain('esm')
    })

    it('html includes app.js script without type="module"', async () => {
      await createProject('my-app', {}, tmp)
      const html = await readFile(join(tmp, 'my-app/src/templates/index.html'), 'utf-8')
      expect(html).toContain('<script src="./app.js">')
      expect(html).not.toContain('type="module"')
    })
  })

  describe('--typescript', () => {
    it('creates expected files including tsconfig and app.ts', async () => {
      await createProject('my-app', { typescript: true }, tmp)
      const files = await listFiles(join(tmp, 'my-app'))
      expect(files).toContain('tsconfig.json')
      expect(files).toContain('src/templates/app.ts')
      expect(files).toContain('src/templates/styles.css')
    })

    it('includes typescript in devDependencies', async () => {
      await createProject('my-app', { typescript: true }, tmp)
      const pkg = JSON.parse(await readFile(join(tmp, 'my-app/package.json'), 'utf-8'))
      expect(pkg.devDependencies.typescript).toBeDefined()
      expect(pkg.devDependencies.vite).toBeDefined()
    })

    it('html references app.ts', async () => {
      await createProject('my-app', { typescript: true }, tmp)
      const html = await readFile(join(tmp, 'my-app/src/templates/index.html'), 'utf-8')
      expect(html).toContain('app.ts')
      expect(html).not.toContain('app.js')
    })

    it('html includes type="module" for Vite to process .ts entry', async () => {
      await createProject('my-app', { typescript: true }, tmp)
      const html = await readFile(join(tmp, 'my-app/src/templates/index.html'), 'utf-8')
      expect(html).toContain('<script type="module" src="./app.ts">')
    })
  })

  describe('--esm', () => {
    it('creates base files (no extra typescript files)', async () => {
      await createProject('my-app', { esm: true }, tmp)
      const files = await listFiles(join(tmp, 'my-app'))
      expect(files).toEqual(BASE_FILES)
    })

    it('config contains esm: true', async () => {
      await createProject('my-app', { esm: true }, tmp)
      const config = await readFile(join(tmp, 'my-app/hyperstache.config.ts'), 'utf-8')
      expect(config).toContain('esm: true')
    })

    it('html includes app.js script with type="module"', async () => {
      await createProject('my-app', { esm: true }, tmp)
      const html = await readFile(join(tmp, 'my-app/src/templates/index.html'), 'utf-8')
      expect(html).toContain('<script type="module" src="./app.js">')
    })
  })

  describe('--typescript --esm', () => {
    it('creates typescript files and config has esm', async () => {
      await createProject('my-app', { typescript: true, esm: true }, tmp)
      const files = await listFiles(join(tmp, 'my-app'))
      expect(files).toContain('tsconfig.json')
      expect(files).toContain('src/templates/app.ts')
      const config = await readFile(join(tmp, 'my-app/hyperstache.config.ts'), 'utf-8')
      expect(config).toContain('esm: true')
    })

    it('html includes app.ts script with type="module"', async () => {
      await createProject('my-app', { typescript: true, esm: true }, tmp)
      const html = await readFile(join(tmp, 'my-app/src/templates/index.html'), 'utf-8')
      expect(html).toContain('<script type="module" src="./app.ts">')
      expect(html).not.toContain('app.js')
    })

    it('includes typescript in devDependencies', async () => {
      await createProject('my-app', { typescript: true, esm: true }, tmp)
      const pkg = JSON.parse(await readFile(join(tmp, 'my-app/package.json'), 'utf-8'))
      expect(pkg.devDependencies.typescript).toBeDefined()
    })
  })

  describe('--admin', () => {
    const ADMIN_FILES = [
      ...BASE_FILES,
      'src/admin/admin.js',
      'src/admin/index.html',
      'src/admin/init.lua',
      'src/admin/styles.css',
    ].sort()

    it('creates base files plus admin scaffold files', async () => {
      await createProject('my-app', { admin: true }, tmp)
      const files = await listFiles(join(tmp, 'my-app'))
      expect(files).toEqual(ADMIN_FILES)
    })

    it('config includes adminInterface: true', async () => {
      await createProject('my-app', { admin: true }, tmp)
      const config = await readFile(join(tmp, 'my-app/hyperstache.config.ts'), 'utf-8')
      expect(config).toContain('adminInterface: true')
    })

    it('config includes handlers: true when admin is set', async () => {
      await createProject('my-app', { admin: true }, tmp)
      const config = await readFile(join(tmp, 'my-app/hyperstache.config.ts'), 'utf-8')
      expect(config).toContain('handlers: true')
    })

    it('config has handlers and adminInterface with admin', async () => {
      await createProject('my-app', { admin: true }, tmp)
      const config = await readFile(join(tmp, 'my-app/hyperstache.config.ts'), 'utf-8')
      expect(config).toContain('handlers: true')
      expect(config).toContain('adminInterface: true')
    })

    it('config enables esm and aoconnect external for admin', async () => {
      await createProject('my-app', { admin: true }, tmp)
      const config = await readFile(join(tmp, 'my-app/hyperstache.config.ts'), 'utf-8')
      expect(config).toContain('esm: true')
      expect(config).toContain('@permaweb/aoconnect')
    })

    it('process.lua requires admin module', async () => {
      await createProject('my-app', { admin: true }, tmp)
      const lua = await readFile(join(tmp, 'my-app/src/process.lua'), 'utf-8')
      expect(lua).toContain("require('admin')")
    })

    it('admin init.lua auto-calls admin.handlers()', async () => {
      await createProject('my-app', { admin: true }, tmp)
      const lua = await readFile(join(tmp, 'my-app/src/admin/init.lua'), 'utf-8')
      expect(lua).toContain('admin.handlers()')
      // The auto-call should appear after the function definition, before return
      const lastHandlers = lua.lastIndexOf('admin.handlers()')
      expect(lua.indexOf('return admin')).toBeGreaterThan(lastHandlers)
    })

    it('config does not include runtime block without admin flag', async () => {
      await createProject('my-app', {}, tmp)
      const config = await readFile(join(tmp, 'my-app/hyperstache.config.ts'), 'utf-8')
      expect(config).not.toContain('adminInterface')
      expect(config).not.toContain('handlers:')
    })
  })

  describe('validation', () => {
    it('rejects invalid project names', async () => {
      await expect(createProject('My App!', {}, tmp)).rejects.toThrow('Invalid project name')
    })

    it('rejects uppercase names', async () => {
      await expect(createProject('MyApp', {}, tmp)).rejects.toThrow('Invalid project name')
    })

    it('rejects empty names', async () => {
      await expect(createProject('', {}, tmp)).rejects.toThrow('Invalid project name')
    })

    it('throws when directory already exists', async () => {
      await createProject('my-app', {}, tmp)
      await expect(createProject('my-app', {}, tmp)).rejects.toThrow('already exists')
    })
  })

  describe('common properties', () => {
    const flagCombos: { label: string; flags: CreateFlags }[] = [
      { label: 'no flags', flags: {} },
      { label: '--typescript', flags: { typescript: true } },
      { label: '--esm', flags: { esm: true } },
      { label: '--typescript --esm', flags: { typescript: true, esm: true } },
      { label: '--admin', flags: { admin: true } },
    ]

    for (const { label, flags } of flagCombos) {
      it(`${label}: package.json has correct name and type`, async () => {
        await createProject('test-proj', flags, tmp)
        const pkg = JSON.parse(await readFile(join(tmp, 'test-proj/package.json'), 'utf-8'))
        expect(pkg.name).toBe('test-proj')
        expect(pkg.type).toBe('module')
        expect(pkg.private).toBe(true)
      })

      it(`${label}: config includes lustache dependency`, async () => {
        await createProject('test-proj', flags, tmp)
        const config = await readFile(join(tmp, 'test-proj/hyperstache.config.ts'), 'utf-8')
        expect(config).toContain('lustache')
      })

      it(`${label}: .gitignore includes node_modules and dist`, async () => {
        await createProject('test-proj', flags, tmp)
        const gi = await readFile(join(tmp, 'test-proj/.gitignore'), 'utf-8')
        expect(gi).toContain('node_modules')
        expect(gi).toContain('dist')
      })
    }
  })

  describe('printNextSteps', () => {
    it('uses project name when no projectDir given', () => {
      const logs: string[] = []
      const orig = console.log
      console.log = (...args: unknown[]) => logs.push(args.join(' '))
      try {
        printNextSteps('my-app')
      } finally {
        console.log = orig
      }
      expect(logs.some(l => l.includes('cd my-app'))).toBe(true)
      expect(logs.some(l => l.includes('Created my-app/'))).toBe(true)
      expect(logs.some(l => l.includes('npm run luarocks-install'))).toBe(true)
      expect(logs.some(l => l.includes('npx hyperstache build'))).toBe(true)
      expect(logs.some(l => l.includes('npx hyperstache dev'))).toBe(false)
    })

    it('uses relative path when projectDir is under cwd', () => {
      const logs: string[] = []
      const orig = console.log
      console.log = (...args: unknown[]) => logs.push(args.join(' '))
      try {
        printNextSteps('my-app', join(process.cwd(), 'projects', 'my-app'))
      } finally {
        console.log = orig
      }
      expect(logs.some(l => l.includes('cd projects/my-app'))).toBe(true)
    })

    it('uses absolute path when projectDir is outside cwd', () => {
      const logs: string[] = []
      const orig = console.log
      console.log = (...args: unknown[]) => logs.push(args.join(' '))
      try {
        printNextSteps('my-app', '/tmp/elsewhere/my-app')
      } finally {
        console.log = orig
      }
      expect(logs.some(l => l.includes('cd /tmp/elsewhere/my-app'))).toBe(true)
    })

    it('returns the correct project directory for custom parentDir', async () => {
      const projectDir = await createProject('my-app', {}, tmp)
      expect(projectDir).toBe(join(tmp, 'my-app'))
    })
  })
})
