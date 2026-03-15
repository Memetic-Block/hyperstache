# hyperstache

Framework for bundling [AO](https://ao.arweave.dev) Lua processes with [Mustache](https://mustache.github.io/) templating, [Luarocks](https://luarocks.org/) support, and [Vite](https://vite.dev/).

HTML templates are inlined as Lua string constants and rendered at runtime using [lustache](https://github.com/Olivine-Labs/lustache) inside the AO process.

Optionally, templates can be processed through Vite before bundling — CSS, TypeScript, and other assets referenced by your HTML are compiled and inlined, producing fully self-contained templates with no external local dependencies.

A single project can define multiple processes, each producing its own self-contained Lua bundle.

## Prerequisites
You will need [luarocks](https://luarocks.org/#quick-start) installed in order to resolve
[lustache](https://luarocks.org/modules/luarocks/lustache) for rendering inside your AO process,
or any other luarock you'll want to use.

## Install

Use in an existing project:

```bash
npm install hyperstache
```

## Quick Start

Scaffold a new project:

```bash
npx hyperstache create my-app
cd my-app
npm install
```

Or choose a template:

```bash
# Vite for CSS/JS processing
npx hyperstache create my-app --template vite

# Vite + TypeScript
npx hyperstache create my-app --template typescript

# Vite + TailwindCSS v4
npx hyperstache create my-app --template tailwind
```

| Template     | Includes                                                     |
|--------------|--------------------------------------------------------------|
| `basic`      | Lua process, Mustache templates, luarocks config             |
| `vite`       | Basic + Vite template processing, CSS                        |
| `typescript` | Vite + TypeScript, tsconfig.json                             |
| `tailwind`   | Vite + TailwindCSS v4 with `@tailwindcss/vite`              |

Then install luarocks dependencies and build:

```bash
npx hyperstache rockspec
luarocks make --only-deps --tree lua_modules *.rockspec
npx hyperstache build
```

### Manual Setup

Create a config file in your project root:

```ts
// hyperstache.config.ts
import { defineConfig } from 'hyperstache'

export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
  },
  luarocks: {
    dependencies: {
      lustache: '1.3.1-0'
    }
  }
})
```

Write your Lua process:

```lua
-- src/process.lua
local templates = require('templates')
local lustache = require('lustache')

Send({
  device = 'patch@1.0',
  home = lustache:render(templates['index.html'], { title = 'Hello' })
})
```

Or Dynamic Read module:
```lua
-- src/dynamic_read.lua
local templates = require('templates')
local lustache = require('lustache')

function hello_world(base, req)
  return lustache:render(templates['index.html'], { title = 'Hello, ' .. req.name .. '!' })
end
```

Add HTML templates alongside your Lua source:

```html
<!-- src/templates/index.html -->
<!DOCTYPE html>
<html>
<head><title>{{title}}</title></head>
<body>
  <h1>{{title}}</h1>
</body>
</html>
```

Build:

```bash
npx hyperstache build
```

This produces a single `dist/process.lua` file with all Lua modules merged and all templates inlined as Lua long strings, ready for AO eval.

Once your process has been deployed, you'll be able to browse your rendered pages from a HyperBEAM node:
```bash
$ curl -L 'https://push.forward.computer/<process_id>/now/home'; echo
```
will return
```html
<!DOCTYPE html>
<html>
<head><title>Hello</title></head>
<body>
  <h1>Hello</h1>
</body>
</html>
```

Or with a dynamic read module such as the one referenced above from a HyperBEAM node:
```bash
$ curl -L 'https://push.forward.computer/<process_id>/now/~lua@5.3a&module=<module_id>/hello_world?name=Hyperstache'; echo
```
will return
```html
<!DOCTYPE html>
<html>
<head><title>Hello, Hyperstache!</title></head>
<body>
  <h1>Hello, Hyperstache!</h1>
</body>
</html>
```

## Multiple Processes

A single project can define multiple AO processes. Each process gets its own entry point and produces a separate bundled Lua file:

```ts
// hyperstache.config.ts
import { defineConfig } from 'hyperstache'

export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
    worker: { entry: 'src/worker.lua', outFile: 'worker.lua' },
  },
  luarocks: {
    dependencies: { lustache: '1.3.1-0' },
  },
})
```

Running `hyperstache build` bundles all processes in parallel, producing `dist/process.lua` and `dist/worker.lua`.

### Per-Process Overrides

Each process inherits top-level `templates` and `luarocks` settings, but can override them:

```ts
export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
    worker: {
      entry: 'src/worker.lua',
      outFile: 'worker.lua',
      templates: { dir: 'src/worker-templates' },
      luarocks: { dependencies: { json: '1.0-0' } },
    },
  },
  templates: { vite: true },
  luarocks: {
    dependencies: { lustache: '1.3.1-0' },
  },
})
```

- **`outFile`** defaults to the entry filename (e.g. `src/worker.lua` → `worker.lua`)
- Per-process `luarocks.dependencies` are merged with shared defaults
- Per-process `templates` settings (extensions, dir, vite) override shared defaults

### Building a Specific Process

Use `--process` to build only one:

```bash
npx hyperstache build --process main
```

## Vite Template Processing

Enable Vite-powered template processing to compile CSS, TypeScript, and other frontend assets directly into your HTML templates before they're bundled into Lua:

```ts
// hyperstache.config.ts
import { defineConfig } from 'hyperstache'

export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
  },
  templates: {
    vite: true,
  },
  luarocks: {
    dependencies: { lustache: '1.3.1-0' },
  },
})
```

Your templates can reference local CSS and JS/TS files with standard HTML tags:

```html
<!-- src/templates/index.html -->
<!DOCTYPE html>
<html>
<head>
  <title>{{title}}</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <h1>{{title}}</h1>
  <div id="app"></div>
  <script type="module" src="./app.ts"></script>
</body>
</html>
```

When you run `hyperstache build`, Vite will:

1. Compile TypeScript, process PostCSS/Tailwind, bundle JS modules
2. Inline all local `<link rel="stylesheet">` → `<style>` and `<script src>` → `<script>` tags
3. Preserve remote URLs (`https://`, `//`) unchanged
4. Preserve all Mustache `{{expressions}}` through the pipeline

The result is self-contained HTML with all assets embedded, ready for Lua inlining.

### Advanced Vite Options

Pass Vite configuration for PostCSS, Tailwind, custom plugins, and more:

```ts
import { defineConfig } from 'hyperstache'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
  },
  templates: {
    vite: {
      plugins: [tailwindcss()],
      css: {
        // PostCSS options, preprocessor options, etc.
      },
      resolve: {
        alias: { '@': './src' },
      },
      define: {
        __APP_VERSION__: JSON.stringify('1.0.0'),
      },
    },
  },
})
```

If a `vite.config.ts` exists in your project root, it will be auto-detected and merged with the template-specific options.

Only `.html` templates are processed through Vite. Other template formats (`.htm`, `.tmpl`, `.mustache`, etc.) pass through unchanged.

## Project Structure

```
my-ao-app/
  hyperstache.config.ts
  package.json
  src/
    process.lua
    worker.lua
    handlers/
      home.lua
    templates/
      index.html
      styles.css
      app.ts
      profile.htm
      layout.tmpl
    lib/
      utils.lua
```

Templates can use any of the default extensions: `.html`, `.htm`, `.tmpl`, `.mustache`, `.mst`, `.mu`, `.stache`.
They are collected, escaped into Lua long-string syntax (`[==[...]==]`),
and made available via `require('templates')` as a table keyed by relative path.

## CLI

```bash
# Create a new project
hyperstache create [name] [--template basic|vite|typescript|tailwind]

# Bundle all processes
hyperstache build

# Bundle a specific process
hyperstache build --process main

# Start Vite dev server with live-reload on Lua/template changes
hyperstache dev

# Generate a .rockspec from config
hyperstache rockspec
```

| Command    | Description                                                      |
|------------|------------------------------------------------------------------|
| `create`   | Scaffold a new hyperstache project from a template               |
| `build`    | Resolve Lua modules, inline templates, emit `.lua` bundles       |
| `dev`      | Start Vite dev server with the hyperstache plugin                |
| `rockspec` | Generate a `.rockspec` file from luarocks config                 |

Options for all commands:

- `-r, --root <dir>` — Project root directory (default: `.`)
- `-p, --process <name>` — Target a specific process (build/dev only)

## Configuration

```ts
import { defineConfig } from 'hyperstache'

export default defineConfig({
  // Named process definitions (required)
  processes: {
    main: {
      entry: 'src/process.lua',    // Lua entry point (required)
      outFile: 'process.lua',      // Output filename (default: derived from entry)
      templates: { /* ... */ },     // Per-process template overrides
      luarocks: { /* ... */ },      // Per-process luarocks overrides
    },
  },

  // Output directory (default: "dist")
  outDir: 'dist',

  // Shared template defaults
  templates: {
    extensions: ['.html', '.htm', '.tmpl', '.mustache', '.mst', '.mu', '.stache'],
    dir: 'src/templates',           // Auto-detected from entry dir by default
    vite: true,                     // or { plugins, css, resolve, define }
  },

  // Shared luarocks defaults
  luarocks: {
    dependencies: { lustache: '1.3.1-0' },
    luaVersion: '5.3',
  },
})
```

## Vite Plugin

Use directly in a `vite.config.ts` for full control:

```ts
import { defineConfig } from 'vite'
import { hyperstache } from 'hyperstache/vite'

export default defineConfig({
  plugins: [
    hyperstache({
      processes: {
        main: { entry: 'src/process.lua' },
      },
      luarocks: {
        dependencies: { lustache: '1.3.1-0' },
      },
    }),
  ],
})
```

The plugin:
- Runs the Lua bundler on `buildStart`
- Watches `.lua` and template files for changes
- When `templates.vite` is enabled, also watches CSS/JS/TS files under the templates directory
- Triggers a full-reload when Lua, template, or asset sources change

## Config Reference

```ts
interface HyperstacheConfig {
  /** Lua entry point */
  entry: string

  /** Output directory (default: 'dist') */
  outDir?: string

  /** Output filename (default: 'process.lua') */
  outFile?: string

  templates?: {
    /** File extensions to treat as templates (default: [ '.html', '.htm', '.tmpl', '.mustache', '.mst', '.mu', '.stache' ]) */
    extensions?: string[]
    /** Directory to scan (default: same as entry file's directory) */
    dir?: string
    /** Process templates through Vite (inline CSS/JS). true for defaults, or pass options. */
    vite?: boolean | {
      plugins?: VitePlugin[]
      css?: ViteCSSOptions
      resolve?: ViteResolveOptions
      define?: Record<string, string>
    }
  }

  luarocks?: {
    /** Dependencies, e.g. { lustache: '1.3.1-0' } */
    dependencies?: Record<string, string>
    /** Lua version for the rockspec (default: '5.3') */
    luaVersion?: string
  }
}
```

## How It Works

1. **Resolve** — Parses `require()` calls from the entry Lua file, recursively resolves modules from the project source tree and `lua_modules/` (luarocks local install)
2. **Collect** — Globs template files, reads them, wraps each in Lua long-string brackets
3. **Render** *(optional)* — If `templates.vite` is enabled, processes `.html` templates through Vite: escapes Mustache syntax, runs Vite build to compile and inline CSS/JS assets, restores Mustache syntax
4. **Emit** — Wraps each module in a function, generates a `require`-compatible loader, inlines templates as a virtual `require('templates')` module, and appends the entry point source
5. **Output** — Writes a single flat `.lua` file to `outDir/outFile`

The output is self-contained and runs in AO's Lua runtime without external dependencies.

## Rockspec Generation

The `hyperstache rockspec` command generates a `.rockspec` file from the `luarocks` section of your config. This is useful for installing dependencies locally with `luarocks install`:

```bash
npx hyperstache rockspec
luarocks install --local --tree lua_modules my-app-0.1.0-1.rockspec
```

The bundler then resolves from `lua_modules/` to inline those dependencies into the final bundle.

## License

AGPLv3
