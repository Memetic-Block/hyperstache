import { mkdir, writeFile, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

const VALID_NAME = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/

export interface CreateFlags {
  typescript?: boolean
  esm?: boolean
  admin?: boolean
}

interface FileEntry {
  path: string
  content: string
}

// ---------------------------------------------------------------------------
// Shared files
// ---------------------------------------------------------------------------

function gitignore(): string {
  return `node_modules/
dist/
lua_modules/
*.rockspec
.env
.hyperstache/
`
}

function readme(name: string): string {
  return `# ${name}

An [AO](https://ao.arweave.net) Lua process built with [hyperstache](https://github.com/memetic-block/hyperstache) and [Vite](https://vite.dev/).

## Getting Started

\`\`\`bash
npm install
npm run luarocks-install
npx hyperstache build
\`\`\`

## Development

\`\`\`bash
npx hyperstache dev
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

// ---------------------------------------------------------------------------
// Flag-dependent files
// ---------------------------------------------------------------------------

function config(flags: CreateFlags): string {
  const viteValue = flags.esm ? '{\n      esm: true,\n    }' : 'true'
  const runtimeBlock = flags.admin
    ? `\n  runtime: {\n    handlers: true,\n    adminInterface: true,\n  },`
    : ''
  return `import { defineConfig } from 'hyperstache'

export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
  },
  templates: {
    vite: ${viteValue},
  },${runtimeBlock}
  luarocks: {
    dependencies: {
      lustache: '1.3.1-0',
    },
  },
  // deploy: {
  //   wallet: './wallet.json',
  //   // hyperbeamUrl: 'https://your-hyperbeam-node.example',
  //   // scheduler: '_GQ33BkPtZrqxA84vM8Zk-N2aO0toNNu_C-l-rawrBA',
  //   // spawnTags: [{ name: 'App-Name', value: '${flags.esm ? 'my-app' : 'my-app'}' }],
  // },
})
`
}

function indexHtml(flags: CreateFlags): string {
  const ext = flags.typescript ? 'ts' : 'js'
  const type = (flags.esm || flags.typescript) ? ' type="module"' : ''
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
  <script${type} src="./app.${ext}"></script>
</body>
</html>
`
}

function appJs(): string {
  return `function greet(name) {
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

function packageJson(name: string, flags: CreateFlags): string {
  const pkg: Record<string, unknown> = {
    name,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      build: 'hyperstache build',
      dev: 'hyperstache dev',
      'luarocks-install': 'hyperstache rockspec && luarocks make --only-deps --tree lua_modules *.rockspec',
      deploy: 'hyperstache deploy',
      publish: 'hyperstache publish',
    },
    devDependencies: {
      hyperstache: 'latest',
      vite: '^6.0.0',
      ...(flags.typescript ? { typescript: '^5.6.0' } : {}),
    },
    dependencies: {
      '@permaweb/aoconnect': '^0.0.93',
      '@ardrive/turbo-sdk': '^1.0.0',
    },
  }
  return JSON.stringify(pkg, null, 2) + '\n'
}

function envExample(): string {
  return `# Arweave JWK wallet file path (used by deploy and publish commands)
# WALLET_PATH=./wallet.json

# HyperBEAM node URL (sets CU, MU, and Gateway for aoconnect)
# HYPERBEAM_URL=https://your-hyperbeam-node.example
`
}

// ---------------------------------------------------------------------------
// File collector
// ---------------------------------------------------------------------------

function buildFiles(name: string, flags: CreateFlags): FileEntry[] {
  const files: FileEntry[] = [
    { path: 'package.json', content: packageJson(name, flags) },
    { path: '.gitignore', content: gitignore() },
    { path: 'README.md', content: readme(name) },
    { path: 'hyperstache.config.ts', content: config(flags) },
    { path: 'src/process.lua', content: processLua() },
    { path: 'src/lib/utils.lua', content: utilsLua() },
    { path: 'src/templates/index.html', content: indexHtml(flags) },
    { path: 'src/templates/styles.css', content: stylesCss() },
    { path: '.env.example', content: envExample() },
  ]

  if (flags.typescript) {
    files.push(
      { path: 'tsconfig.json', content: tsconfig() },
      { path: 'src/templates/app.ts', content: appTs() },
    )
  } else {
    files.push({ path: 'src/templates/app.js', content: appJs() })
  }

  return files
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function createProject(
  name: string,
  flags: CreateFlags = {},
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

  const files = buildFiles(name, flags)

  for (const file of files) {
    const filePath = join(projectDir, file.path)
    await mkdir(join(filePath, '..'), { recursive: true })
    await writeFile(filePath, file.content)
  }

  return projectDir
}

export function printNextSteps(name: string, projectDir?: string): void {
  const cwd = process.cwd()
  let cdTarget: string
  if (projectDir) {
    const rel = relative(cwd, projectDir)
    cdTarget = rel.startsWith('..') ? projectDir : rel
  } else {
    cdTarget = name
  }

  console.log()
  console.log(`  Created ${cdTarget}/`)
  console.log()
  console.log('  Next steps:')
  console.log()
  console.log(`    cd ${cdTarget}`)
  console.log('    npm install')
  console.log('    npm run luarocks-install')
  console.log('    npx hyperstache build')
  console.log()
}
