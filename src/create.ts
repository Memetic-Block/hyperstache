import { mkdir, writeFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const VALID_NAME = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/

const TEMPLATES = ['basic', 'vite', 'typescript', 'tailwind'] as const
export type TemplateName = (typeof TEMPLATES)[number]

export function isValidTemplate(name: string): name is TemplateName {
  return TEMPLATES.includes(name as TemplateName)
}

interface FileEntry {
  path: string
  content: string
}

// ---------------------------------------------------------------------------
// Shared files (all templates)
// ---------------------------------------------------------------------------

function gitignore(): string {
  return `node_modules/
dist/
lua_modules/
*.rockspec
.env
`
}

function readme(name: string): string {
  return `# ${name}

An [AO](https://ao.arweave.net) Lua process built with [hyperstache](https://github.com/memetic-block/hyperstache).

## Getting Started

\`\`\`bash
npm install
npx hyperstache rockspec
luarocks make --only-deps --tree lua_modules *.rockspec
npx hyperstache build
\`\`\`

## Development

\`\`\`bash
npx hyperstache build
\`\`\`
`
}

function processLua(): string {
  return `local templates = require('templates')
local lustache = require('lustache')

Send({
  device = 'patch@1.0',
  home = lustache:render(templates['index.html'], { title = 'Hello', name = Owner })
})
`
}

function utilsLua(): string {
  return `local M = {}

function M.get_name(address)
  return string.sub(address, 1, 8) .. "..."
end

return M
`
}

function indexHtml(): string {
  return `<!DOCTYPE html>
<html>
<head><title>{{title}}</title></head>
<body>
  <h1>{{title}}</h1>
  <p>Hello, {{name}}!</p>
</body>
</html>
`
}

function configBasic(): string {
  return `import { defineConfig } from 'hyperstache'

export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
  },
  luarocks: {
    dependencies: {
      lustache: '1.3.1-0',
    },
  },
})
`
}

// ---------------------------------------------------------------------------
// Vite additions
// ---------------------------------------------------------------------------

function configVite(): string {
  return `import { defineConfig } from 'hyperstache'

export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
  },
  templates: {
    vite: true,
  },
  luarocks: {
    dependencies: {
      lustache: '1.3.1-0',
    },
  },
})
`
}

function indexHtmlVite(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>{{title}}</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <h1>{{title}}</h1>
  <p>Hello, {{name}}!</p>
</body>
</html>
`
}

function stylesCss(): string {
  return `body {
  font-family: system-ui, -apple-system, sans-serif;
  margin: 0;
  padding: 2rem;
  background: #f5f5f5;
}

h1 {
  color: #333;
}
`
}

function readmeVite(name: string): string {
  return `# ${name}

An [AO](https://ao.arweave.net) Lua process built with [hyperstache](https://github.com/memetic-block/hyperstache) and [Vite](https://vite.dev/).

## Getting Started

\`\`\`bash
npm install
npx hyperstache rockspec
luarocks make --only-deps --tree lua_modules *.rockspec
npx hyperstache build
\`\`\`

## Development

\`\`\`bash
npx hyperstache dev
\`\`\`
`
}

// ---------------------------------------------------------------------------
// TypeScript additions
// ---------------------------------------------------------------------------

function indexHtmlTs(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>{{title}}</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <h1>{{title}}</h1>
  <p>Hello, {{name}}!</p>
  <div id="greeting"></div>
  <script type="module" src="./app.ts"></script>
</body>
</html>
`
}

function appTs(): string {
  return `function greet(name: string): string {
  return \`Hello, \${name}!\`
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('greeting')
  if (el) {
    el.textContent = greet('World')
  }
})
`
}

function tsconfig(): string {
  return `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
`
}

// ---------------------------------------------------------------------------
// Tailwind additions
// ---------------------------------------------------------------------------

function configTailwind(): string {
  return `import { defineConfig } from 'hyperstache'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
  },
  templates: {
    vite: {
      plugins: [tailwindcss()],
    },
  },
  luarocks: {
    dependencies: {
      lustache: '1.3.1-0',
    },
  },
})
`
}

function stylesTailwind(): string {
  return `@import "tailwindcss";
`
}

function indexHtmlTailwind(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>{{title}}</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body class="bg-gray-100 p-8">
  <h1 class="text-3xl font-bold text-gray-800">{{title}}</h1>
  <p class="mt-2 text-gray-600">Hello, {{name}}!</p>
</body>
</html>
`
}

// ---------------------------------------------------------------------------
// Package.json generators
// ---------------------------------------------------------------------------

function packageJson(name: string, template: TemplateName): string {
  const pkg: Record<string, unknown> = {
    name,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      build: 'hyperstache build',
      ...(template !== 'basic' ? { dev: 'hyperstache dev' } : {}),
    },
    devDependencies: {
      hyperstache: 'latest',
      ...(template !== 'basic' ? { vite: '^6.0.0' } : {}),
      ...(template === 'typescript' ? { typescript: '^5.6.0' } : {}),
      ...(template === 'tailwind'
        ? { '@tailwindcss/vite': '^4.0.0', tailwindcss: '^4.0.0' }
        : {}),
    },
  }
  return JSON.stringify(pkg, null, 2) + '\n'
}

// ---------------------------------------------------------------------------
// File collectors per template
// ---------------------------------------------------------------------------

function basicFiles(name: string): FileEntry[] {
  return [
    { path: 'package.json', content: packageJson(name, 'basic') },
    { path: '.gitignore', content: gitignore() },
    { path: 'README.md', content: readme(name) },
    { path: 'hyperstache.config.ts', content: configBasic() },
    { path: 'src/process.lua', content: processLua() },
    { path: 'src/lib/utils.lua', content: utilsLua() },
    { path: 'src/templates/index.html', content: indexHtml() },
  ]
}

function viteFiles(name: string): FileEntry[] {
  return [
    { path: 'package.json', content: packageJson(name, 'vite') },
    { path: '.gitignore', content: gitignore() },
    { path: 'README.md', content: readmeVite(name) },
    { path: 'hyperstache.config.ts', content: configVite() },
    { path: 'src/process.lua', content: processLua() },
    { path: 'src/lib/utils.lua', content: utilsLua() },
    { path: 'src/templates/index.html', content: indexHtmlVite() },
    { path: 'src/templates/styles.css', content: stylesCss() },
  ]
}

function typescriptFiles(name: string): FileEntry[] {
  return [
    { path: 'package.json', content: packageJson(name, 'typescript') },
    { path: '.gitignore', content: gitignore() },
    { path: 'README.md', content: readmeVite(name) },
    { path: 'hyperstache.config.ts', content: configVite() },
    { path: 'tsconfig.json', content: tsconfig() },
    { path: 'src/process.lua', content: processLua() },
    { path: 'src/lib/utils.lua', content: utilsLua() },
    { path: 'src/templates/index.html', content: indexHtmlTs() },
    { path: 'src/templates/styles.css', content: stylesCss() },
    { path: 'src/templates/app.ts', content: appTs() },
  ]
}

function tailwindFiles(name: string): FileEntry[] {
  return [
    { path: 'package.json', content: packageJson(name, 'tailwind') },
    { path: '.gitignore', content: gitignore() },
    { path: 'README.md', content: readmeVite(name) },
    { path: 'hyperstache.config.ts', content: configTailwind() },
    { path: 'src/process.lua', content: processLua() },
    { path: 'src/lib/utils.lua', content: utilsLua() },
    { path: 'src/templates/index.html', content: indexHtmlTailwind() },
    { path: 'src/templates/styles.css', content: stylesTailwind() },
  ]
}

const FILE_BUILDERS: Record<TemplateName, (name: string) => FileEntry[]> = {
  basic: basicFiles,
  vite: viteFiles,
  typescript: typescriptFiles,
  tailwind: tailwindFiles,
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function createProject(
  name: string,
  template: TemplateName,
  parentDir: string = process.cwd(),
): Promise<string> {
  if (!VALID_NAME.test(name)) {
    throw new Error(
      `Invalid project name "${name}". Use lowercase alphanumeric characters, hyphens, dots, or underscores.`,
    )
  }

  const projectDir = resolve(parentDir, name)

  try {
    await stat(projectDir)
    throw new Error(`Directory "${name}" already exists.`)
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      // Directory doesn't exist — good
    } else {
      throw err
    }
  }

  const files = FILE_BUILDERS[template](name)

  for (const file of files) {
    const filePath = join(projectDir, file.path)
    await mkdir(join(filePath, '..'), { recursive: true })
    await writeFile(filePath, file.content)
  }

  return projectDir
}

export function printNextSteps(name: string, template: TemplateName): void {
  console.log()
  console.log(`  Created ${name}/ with the ${template} template.`)
  console.log()
  console.log('  Next steps:')
  console.log()
  console.log(`    cd ${name}`)
  console.log('    npm install')
  console.log('    npx hyperstache rockspec')
  console.log('    luarocks make --only-deps --tree lua_modules *.rockspec')
  if (template !== 'basic') {
    console.log('    npx hyperstache dev')
  } else {
    console.log('    npx hyperstache build')
  }
  console.log()
}
