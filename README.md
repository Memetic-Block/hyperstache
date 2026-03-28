# hyperengine

Framework for bundling [AO](https://ao.arweave.net) Lua processes for deployment on [HyperBEAM](https://hyperbeam.arweave.net) with
[Mustache](https://mustache.github.io/) templating and optional [Luarocks](https://luarocks.org/) support.

HTML templates are inlined as Lua string constants and rendered at runtime using a bundled [lustache](https://github.com/Olivine-Labs/lustache) engine inside the AO process.

Optionally, templates can be processed through Vite before bundling — CSS, TypeScript, and other assets referenced by your HTML are compiled and inlined, producing fully self-contained templates with no external local dependencies.

A single project can define multiple processes, each producing its own self-contained Lua bundle.

Bundled artifacts may optionally be output as aos modules ready to be build into a self-contained artifact with the [ao dev cli](https://github.com/permaweb/ao).

## Table of Contents

- [Prerequisites](#prerequisites)
- [Install](#install)
- [Quick Start](#quick-start)
  - [Manual Setup](#manual-setup)
- [Multiple Processes](#multiple-processes)
  - [Dynamic Read Modules](#dynamic-read-modules)
  - [Per-Process Overrides](#per-process-overrides)
  - [Building a Specific Process](#building-a-specific-process)
- [Vite Template Processing](#vite-template-processing)
  - [Advanced Vite Options](#advanced-vite-options)
  - [External Dependencies](#external-dependencies)
    - [Import Maps for External JS](#import-maps-for-external-js)
  - [ESM Mode](#esm-mode)
- [Runtime Template Management](#runtime-template-management)
  - [Auto Re-render (publishTemplate)](#auto-re-render-publishtemplate)
  - [AO Message Handlers](#ao-message-handlers)
  - [Access Control (ACL)](#access-control-acl)
    - [Granting Roles](#granting-roles)
    - [Admin Delegation](#admin-delegation)
    - [ACL API](#acl-api)
  - [Per-Process Runtime Override](#per-process-runtime-override)
  - [Admin Interface](#admin-interface)
    - [Scaffolding](#scaffolding)
    - [How It Works](#how-it-works-1)
    - [Custom Path Key](#custom-path-key)
    - [Custom Admin Directory](#custom-admin-directory)
- [AOS Module Build](#aos-module-build)
  - [Excluding Default Modules](#excluding-default-modules)
  - [AOS Build Options](#aos-build-options)
  - [Caching](#caching)
  - [Requirements](#requirements)
- [Project Structure](#project-structure)
- [CLI](#cli)
- [Configuration](#configuration)
  - [Full Config Interface](#full-config-interface)
- [Testing](#testing)
- [How It Works](#how-it-works)
- [Deploy & Publish](#deploy--publish)
  - [Configuration](#deploy-configuration)
  - [.env File Support](#env-file-support)
  - [Single-File Process Deploy](#single-file-process-deploy)
  - [Module Build Deploy](#module-build-deploy)
  - [Publishing Modules](#publishing-modules)
  - [Deploy Manifest](#deploy-manifest)
- [Rockspec Generation](#rockspec-generation)
- [License](#license)

## Prerequisites
[Luarocks](https://luarocks.org/#quick-start) is only needed if you want to use additional Lua dependencies
beyond the built-in [lustache](https://github.com/Olivine-Labs/lustache) template engine, which is bundled automatically.

## Install

Use in an existing project:

```bash
npm install @memetic-block/hyperengine
```

## Quick Start

Scaffold a new project:

```bash
npx hyperengine create my-app
cd my-app
npm install
```

Add flags to customize the scaffold:

```bash
# With TypeScript support
npx hyperengine create my-app --typescript

# With ESM mode for inlined scripts
npx hyperengine create my-app --esm

# Combine flags
npx hyperengine create my-app --typescript --esm

# With admin interface for template & ACL management
npx hyperengine create my-app --admin

# Specify a target directory
npx hyperengine create my-app --directory ~/projects
```

| Flag           | Effect                                                       |
|----------------|--------------------------------------------------------------|
| `--typescript` | Adds TypeScript: tsconfig.json, app.ts entry, `type="module"` on script tags, TS devDep |
| `--esm`        | Enables ESM mode in the Vite config (`vite: { esm: true }`)  |
| `--admin`      | Scaffolds admin UI files into `src/admin/` and enables admin interface in config  |
| `--directory`  | Parent directory for the new project (default: current dir)   |

All scaffolded projects include Vite template processing and CSS out of the box.

Build:

```bash
npx hyperengine build
```

### Manual Setup

Create a config file in your project root:

```ts
// hyperengine.config.ts
import { defineConfig } from '@memetic-block/hyperengine'

export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
  },
})
```

Write your Lua process:

```lua
-- src/process.lua
local hs = require('hyperengine')

hs.publish({
  home = hs.render(hs.get('index.html'), { greeting = 'Hello' })
})
```

Or Dynamic Read module:
```lua
-- src/dynamic_read.lua
local hs = require('hyperengine')

function hello_world(base, req)
  return hs.render(hs.get('index.html'), { greeting = 'Hello, ' .. req.name .. '!' })
end
```

Add HTML templates alongside your Lua source:

```html
<!-- src/templates/index.html -->
<!DOCTYPE html>
<html>
<head><title>{{greeting}}</title></head>
<body>
  <h1>{{greeting}}</h1>
</body>
</html>
```

Build:

```bash
npx hyperengine build
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
$ curl -L 'https://push.forward.computer/<process_id>/now/~lua@5.3a&module=<module_id>/hello_world?name=Hyperengine'; echo
```
will return
```html
<!DOCTYPE html>
<html>
<head><title>Hello, Hyperengine!</title></head>
<body>
  <h1>Hello, Hyperengine!</h1>
</body>
</html>
```

## Multiple Processes

A single project can define multiple AO processes. Each process gets its own entry point and produces a separate bundled Lua file:

```ts
// hyperengine.config.ts
import { defineConfig } from '@memetic-block/hyperengine'

export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
    worker: { entry: 'src/worker.lua', outFile: 'worker.lua' },
  },
})
```

Running `hyperengine build` bundles all processes in parallel, producing `dist/process.lua` and `dist/worker.lua`.

### Dynamic Read Modules

Not every output artifact is a process. Set `type: 'module'` to mark an entry as a **dynamic read module** — a standalone Lua bundle that is not an AO process:

```ts
export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
    reader: { entry: 'src/reader.lua', type: 'module' },
  },
  aos: { commit: 'abc1234' },
})
```

Module-type artifacts:

- Use the **raw bundle format** (no `_init()` wrapper), identical to a standard non-AOS build
- **Skip the AOS build entirely** — no repo clone, no file copy, no `require()` injection — even when the project has `aos` configured
- Output directly to `dist/reader.lua` instead of nesting under a subdirectory
- Support all the same features as processes: templates, luarocks, runtime

The default type is `'process'`, so existing configs are unaffected.

### Per-Process Overrides

Each process inherits top-level `templates` settings, but can override them:

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
})
```

- **`outFile`** defaults to the entry filename (e.g. `src/worker.lua` → `worker.lua`)
- Per-process `luarocks.dependencies` are merged with shared defaults
- Per-process `templates` settings (extensions, dir, vite) override shared defaults

### Building a Specific Process

Use `--process` to build only one:

```bash
npx hyperengine build --process main
```

## Vite Template Processing

Enable Vite-powered template processing to compile CSS, TypeScript, and other frontend assets directly into your HTML templates before they're bundled into Lua:

```ts
// hyperengine.config.ts
import { defineConfig } from '@memetic-block/hyperengine'

export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
  },
  templates: {
    vite: true,
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

When you run `hyperengine build`, Vite will:

1. Compile TypeScript, process PostCSS/Tailwind, bundle JS modules
2. Inline all local `<link rel="stylesheet">` → `<style>` and `<script src>` → `<script>` tags
3. Preserve remote URLs (`https://`, `//`) unchanged
4. Preserve all Mustache `{{expressions}}` through the pipeline

The result is self-contained HTML with all assets embedded, ready for Lua inlining.

### Advanced Vite Options

Pass Vite configuration for PostCSS, Tailwind, custom plugins, and more:

```ts
import { defineConfig } from '@memetic-block/hyperengine'
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

### External Dependencies

By default, Vite inlines all local CSS and JS assets into the HTML output. Use `external` to prevent specific dependencies from being bundled — Rollup will leave their imports untouched:

```ts
import { defineConfig } from '@memetic-block/hyperengine'

export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
  },
  templates: {
    vite: {
      external: ['./styles.css', /^@vendor\//],
    },
  },
})
```

The `external` array accepts strings and regular expressions, matching [Rollup's external option](https://rollupjs.org/configuration-options/#external). Matched imports are preserved as-is in the HTML output instead of being compiled and inlined.

#### Import Maps for External JS

For external JavaScript modules that your frontend code loads via dynamic `import()`, you can specify a URL alongside each external. Hyperengine will inject a [`<script type="importmap">`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap) into each HTML template's `<head>` so the browser can resolve bare import specifiers at runtime:

```ts
import { defineConfig } from '@memetic-block/hyperengine'

export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
  },
  templates: {
    vite: {
      external: [
        { name: 'htmx', url: 'https://cdn.example.com/htmx.esm.js' },
        { name: 'alpine', url: 'ar://abc123txid' },
        './styles.css',  // plain externals still work as before
      ],
    },
  },
})
```

This produces the following in each HTML `<head>`:

```html
<script type="importmap">
{
  "imports": {
    "htmx": "https://cdn.example.com/htmx.esm.js",
    "alpine": "/abc123txid"
  }
}
</script>
```

Your inlined frontend code can then use standard dynamic imports:

```ts
const htmx = await import('htmx')
const alpine = await import('alpine')
```

**Arweave wayfinder URLs** (`ar://<txid>`) are resolved to relative paths (`/<txid>`). When the HTML is served from a HyperBEAM node, the browser resolves these against the node's origin, allowing the node to proxy the Arweave content transparently.

| Entry format | Rollup external | Import map entry |
|---|---|---|
| `'lodash'` | Yes | No |
| `/^@scope\//` | Yes | No |
| `{ name: 'htmx', url: 'https://...' }` | Yes | `"htmx": "https://..."` |
| `{ name: 'lib', url: 'ar://txid' }` | Yes | `"lib": "/txid"` |

Configured externals are reported in the `BundleResult.viteExternals` array for programmatic consumers.

### ESM Mode

When developing with ESM `<script type="module">` entry points in your HTML templates, enable `esm: true` to preserve module semantics through inlining:

```ts
import { defineConfig } from '@memetic-block/hyperengine'

export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
  },
  templates: {
    vite: { esm: true },
  },
})
```

With ESM mode enabled, you can author templates like this:

```html
<!-- src/templates/index.html -->
<!DOCTYPE html>
<html>
<head><title>{{title}}</title></head>
<body>
  <script type="module" src="./app.ts"></script>
</body>
</html>
```

After building, the output preserves both scripts — existing inline scripts are kept verbatim while `src` scripts are transpiled and inlined:

```html
<body>
  <script type="module">/* transpiled app.ts code */</script>
</body>
```

Specifically, `esm: true` does two things:

1. **Preserves `type="module"`** on inlined `<script src="...">` tags (by default it is stripped since inlined code runs as a classic script)
2. **Protects pre-existing inline scripts** — `<script>` tags that already contain code (no `src` attribute) are passed through untouched, preventing Vite from transforming them

Without `esm`, the default behavior is unchanged: `type="module"` is stripped from inlined scripts and Vite processes all script blocks normally.

## Runtime Template Management

Hyperengine automatically bundles a `hyperengine` Lua runtime module into every process for managing templates after deployment. The runtime source includes [LuaDoc annotations](https://luals.github.io/wiki/annotations/) (`---@param`, `---@return`, `---@class`, `---@alias`, etc.) for full IDE autocompletion and type checking in editors that support the [Lua Language Server](https://github.com/LuaLS/lua-language-server).

You can require it in your Lua process:

```lua
local hs = require('hyperengine')

-- Render a bundled template by key
local html = hs.renderTemplate('index.html', { title = 'Hello' })

-- Render a raw template string
local raw = hs.render('<h1>{{title}}</h1>', { title = 'Hello' })

-- Render with partials (other templates included via {{>partial_name}})
local html = hs.renderTemplate('index.html', { title = 'Hello' }, {
  header = '<header>{{title}}</header>',
  footer = '<footer>© 2025</footer>',
})

-- Add or update a template at runtime
hs.set('banner.html', '<div class="banner">{{message}}</div>')

-- Retrieve raw template content
local tmpl = hs.get('banner.html')

-- List all template keys
local keys = hs.list()

-- Remove a template
hs.remove('old.html')

-- Force re-seed from bundled templates (overwrites runtime changes)
hs.sync()

-- Publish rendered content to patch@1.0 under the configured patchKey
-- The admin interface uses this internally; you can also use it in your own code
hs.publish({ page = hs.renderTemplate('index.html', { title = 'Hello' }) })
```

The runtime module:

- **Seeds from build-time templates** — On first load, all bundled templates are copied into the runtime store. On redeployment, new bundled templates merge in without overwriting runtime modifications.
- **Persists across reloads** — State is stored in the lowercase global `hyperengine_templates`
- **Integrates with lustache** — `hs.renderTemplate(key, data, partials)` looks up a template by key and renders it; `hs.render(template, data, partials)` renders a raw template string directly.
- **Partials support** — Both render methods accept an optional third argument: a table of partials (keyed by name, values are template strings). All registered `hyperengine_templates` are automatically available as partials, so `{{>index.html}}` works in any template without extra setup. Explicit partials override same-named keys from the template store.
- **Publish to patch@1.0** — `hs.publish(patches)` sends rendered content to `patch@1.0`, nesting the payload under the configured `patchKey` (default `"ui"`). This prevents raw HTML from appearing in message headers, which would otherwise break `@permaweb/aoconnect` methods. The JSON device lazylink-encodes the HTML within the nested key. Patches are accumulated in the persistent `hyperengine_patches` global — each call merges new keys and sends the full state, so no previously-published pages are lost. Use `hs.patch(patches)` to register content without sending (useful during init when multiple modules contribute pages before the first publish).
- **Auto-sync state to patch@1.0** — `hyperengine_templates` and `hyperengine_acl` are automatically sent to `patch@1.0` under the configured `stateKey` (default `"hyperengine_state"`) whenever they change (`set`, `remove`, `sync`, `grant`, `revoke`) and at init. The state is nested as `{ templates = hyperengine_templates, acl = hyperengine_acl }`, making it fetchable via URL GET on HyperBEAM mainnet at `/<process_id>/now/hyperengine_state/templates/...` and `/<process_id>/now/hyperengine_state/acl/...`. No manual publish step is needed for template or ACL state.

### Auto Re-render (publishTemplate)

Use `hs.publishTemplate()` to render a template, publish it to `patch@1.0`, and **automatically re-render** whenever the source template (or any partial it depends on) is updated at runtime:

```lua
local hs = require('hyperengine')

-- Render and publish 'index.html' under the patch path 'page'
-- If someone later calls hs.set('index.html', newContent), the page
-- will automatically re-render and re-publish with the same data.
hs.publishTemplate('index.html', 'page', { title = 'Hello', user = 'Alice' })

-- Use a callback function for dynamic data (re-fetched on each re-render)
-- Note: function callbacks do not persist across AO process reloads
hs.publishTemplate('dashboard.html', 'dashboard', function()
  return { stats = getStats(), timestamp = os.time() }
end)

-- Partials are tracked transitively — if index.html includes {{>header.html}},
-- updating header.html will also trigger a re-render of the page.
hs.publishTemplate('index.html', 'page', { title = 'Hello' }, {
  footer = '<footer>Custom</footer>'
})

-- Stop auto-re-rendering and remove a published path
hs.unpublishTemplate('page')
```

**How it works:**

- `publishTemplate(key, patchPath, data, partials, statePath)` renders the template, stores the registration in the persistent `hyperengine_published` global, and publishes the result to `patch@1.0` under the configured `patchKey`. The optional `statePath` string is stored alongside the registration for UI display (it records which Lua global the `data` function references).
- `listPublished()` returns a serializable view of all published templates: `{ [patchPath] = { key, statePath } }`.
- When `set()` or `remove()` modifies a template, all published templates whose source key matches — or whose template transitively depends on the changed key via mustache partials (`{{>name}}`) — are automatically re-rendered and re-published in a single batched `Send`.
- When `sync()` overwrites templates from the bundle, all published templates are re-rendered.
- The `data` argument can be a **table** (persisted across AO process reloads) or a **function** (called on each render for fresh data; lost on process reload since functions can't be serialized).
- Re-render failures (e.g., missing template after removal) are silently skipped via `pcall` — they won't crash your process.

The admin interface uses `publishTemplate` internally, so editing `admin/index.html` via `Hyperengine-Set` automatically re-renders and re-publishes the admin UI.

### AO Message Handlers

Enable `handlers: true` to auto-register AO message handlers for remote template management:

```ts
export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
  },
  handlers: true,
})
```

This registers twelve handlers:

| Action                       | Tags              | Description                                                       | Access       |
|------------------------------|-------------------|-------------------------------------------------------------------|--------------|
| `Hyperengine-Get`            | `Key`             | Returns raw template content                                      | Anyone       |
| `Hyperengine-List`           |                   | Returns all template keys                                         | Anyone       |
| `Hyperengine-RenderTemplate` | `Key`             | Renders a stored template by key (JSON `{ data, partials }` payload) | Anyone       |
| `Hyperengine-Render`         |                   | Renders a raw template string (JSON `{ template, data, partials }` payload) | Anyone       |
| `Hyperengine-Set`            | `Key`             | Creates/updates a template                                        | Permitted    |
| `Hyperengine-Remove`         | `Key`             | Deletes a template                                                | Permitted    |
| `Hyperengine-Grant-Role` | `Address`, `Role` | Grants an ACL role to an address        | Owner/Admin  |
| `Hyperengine-Revoke-Role`| `Address`, `Role` | Revokes an ACL role from an address     | Owner/Admin  |
| `Hyperengine-Get-Roles`  | `Address`         | Returns roles for an address (or all)   | Anyone       |
| `Hyperengine-Publish-Template` | `Key`, `Path`, `State-Path`? | Publishes a rendered template at a patch path. Optional `State-Path` references a Lua global for live data. | Permitted |
| `Hyperengine-Unpublish-Template` | `Path`       | Removes a published template from a patch path | Permitted |
| `Hyperengine-List-Published` |                   | Returns JSON of all published templates (`{ path: { key, statePath } }`) | Anyone |

Mutation operations (`Set`, `Remove`, `Publish-Template`, `Unpublish-Template`) are guarded by a permission check — the caller must be the process Owner, have the `admin` role, or have been granted the specific action (e.g. `Hyperengine-Set`).

You can also register handlers manually from your process code:

```lua
local hs = require('hyperengine')
hs.handlers()  -- registers all twelve handlers
```

### Access Control (ACL)

The runtime includes a role-based access control system. The process **Owner** always has full access. Other addresses can be granted per-action permissions or the `admin` role, which grants all write permissions plus the ability to manage roles for others.

ACL state is stored in the lowercase global `hyperengine_acl` (auto-persisted by AO across reloads).

#### Granting Roles

Grant a specific action to an address:

```lua
-- From AO messages:
Send({
  Target = process_id,
  Action = 'Hyperengine-Grant-Role',
  Tags = { Address = 'some-wallet-address', Role = 'Hyperengine-Set' }
})
```

Valid role values:

| Role                | Effect                                         |
|---------------------|-------------------------------------------------|
| `admin`             | All write actions + can grant/revoke non-admin roles |
| `Hyperengine-Set`   | Can create/update templates                     |
| `Hyperengine-Remove`| Can delete templates                            |

Revoke a role the same way:

```lua
Send({
  Target = process_id,
  Action = 'Hyperengine-Revoke-Role',
  Tags = { Address = 'some-wallet-address', Role = 'Hyperengine-Set' }
})
```

Query roles for an address (public):

```lua
Send({
  Target = process_id,
  Action = 'Hyperengine-Get-Roles',
  Tags = { Address = 'some-wallet-address' }
})
-- Returns: newline-separated role names, e.g. "Hyperengine-Set\nHyperengine-Remove"

-- Omit Address to get all ACL entries:
Send({ Target = process_id, Action = 'Hyperengine-Get-Roles' })
-- Returns: "address1:role1,role2\naddress2:role3"
```

#### Admin Delegation

- The **Owner** can grant and revoke any role, including `admin`
- An **admin** can grant and revoke per-action roles (`Hyperengine-Set`, `Hyperengine-Remove`) but **cannot** grant or revoke the `admin` role — only the Owner can escalate or de-escalate admin privileges

#### ACL API

The ACL functions are also available directly in Lua:

```lua
local hs = require('hyperengine')

-- Check if an address has permission for an action
hs.has_permission(address, 'Hyperengine-Set')  -- true/false

-- Grant a role
hs.grant(address, 'Hyperengine-Set')

-- Revoke a role (cleans up empty entries)
hs.revoke(address, 'Hyperengine-Set')

-- Get roles for an address (returns table, e.g. { ["Hyperengine-Set"] = true })
hs.get_roles(address)

-- Get all ACL entries (returns full hyperengine_acl table)
hs.get_roles()
```

### Per-Process Overrides

Like templates and luarocks, `handlers` and `adminInterface` can be set per-process:

```ts
export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua', handlers: true },
    worker: { entry: 'src/worker.lua' },
  },
})
```

### Admin Interface

Hyperengine includes an optional admin UI for managing templates and ACL directly from a browser. Unlike most bundler internals, the admin files are **scaffolded into your project** as separate HTML, CSS, JS, and Lua files that you can freely customize.

#### Scaffolding

Use the `--admin` flag when creating a new project:

```bash
npx hyperengine create my-app --admin
```

This creates the following files under `src/admin/`:

| File / Directory          | Purpose                                                         |
|---------------------------|-----------------------------------------------------------------|
| `template.html`           | Admin UI layout — mustache template with header, nav, body, and footer partials |
| `styles.css`              | Admin UI styles (dark theme, GitHub Primer-inspired)            |
| `admin.js`                | Frontend logic — tab switching, template CRUD, ACL management, publish management |
| `init.lua`                | Lua module — publishes admin routes via `hyperengine.publishTemplate` |
| `pages/index.mu`          | Home page partial                                               |
| `pages/templates.mu`      | Templates management page partial                               |
| `pages/publish.mu`        | Publish management page partial                                 |
| `pages/acl.mu`            | Access control page partial                                     |
| `pages/preview.mu`        | Render preview page partial                                     |
| `partials/header.mu`      | Header partial                                                  |
| `partials/nav.mu`         | Navigation partial                                              |
| `partials/footer.mu`      | Footer partial                                                  |

All four files are fully editable. The HTML references the CSS and JS via standard `<link>` and `<script>` tags, and the Vite template pipeline inlines them at build time — just like your regular templates.

The scaffolded config enables ESM mode and adds `@permaweb/aoconnect` as a Vite external (loaded via import map from Arweave):

```ts
import { defineConfig } from '@memetic-block/hyperengine'

export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
  },
  templates: {
    vite: {
      esm: true,
      external: [
        { name: '@permaweb/aoconnect', url: 'ar://g2XHqQZLuyssd0_DRMB-cx1BC-TUPTHI1n8nwfFKHM0' },
      ],
    },
  },
  handlers: true,
  adminInterface: true,
})
```

Enabling `adminInterface` automatically enables `handlers` — the admin UI communicates with the process through the existing `Hyperengine-*` message handlers.

#### How It Works

At build time, hyperengine:

1. **Resolves** `src/admin/init.lua` as a regular Lua module (name: `admin`)
2. **Collects** HTML and mustache files from `src/admin/` as admin templates (prefixed with `admin/`, e.g. `admin/template.html`, `admin/pages/index.mu`)
3. **Merges** admin templates with your regular templates from `src/templates/`
4. **Processes** all templates through Vite together — admin CSS and JS are inlined into the admin HTML
5. **Emits** the admin module alongside your other modules, with an auto-`require("admin")` in the entry point

The admin Lua module:

- **Auto-initializes on load** — when the bundler auto-requires the admin module, `admin.publish()` fires automatically, publishing each admin route via `hyperengine.publishTemplate()` with mustache partials for header, nav, body, and footer. The user's `hyperengine.publish()` call in the entry point then sends the full state — including the admin pages — in a single message.
- **Publishes to `patch@1.0`** after every mutation (template Set/Remove, role Grant/Revoke) via `hyperengine.publish()`, which sends the full accumulated state
- **Stores the rendered HTML** in the `hyperengine_admin` global (auto-persisted by AO)

The admin UI has four sections:

| Section          | Description                                                |
|------------------|------------------------------------------------------------||
| **Templates**    | List, view, create, edit, and delete templates             |
| **Access Control** | View all roles, grant roles to addresses, revoke roles   |
| **Render Preview** | Select a template, provide JSON data, preview the output |
| **Publish**      | Publish templates at custom paths, manage published templates, reference live process state |

#### Custom Path Key

By default, the admin UI is registered under the `admin` key inside the `patchKey` namespace (default `"ui"`) via `hyperengine.patch({ admin = html })` on init, and sent via `hyperengine.publish()` on mutations. To use a different path key, configure it in your config:

```ts
export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
  },
  adminInterface: { path: 'manage' },
})
```

The admin page is then accessible at:

```bash
curl -L 'https://push.forward.computer/<process_id>/now/ui/manage'
```

You can also change the top-level `patchKey` (the namespace under which all published content is nested):

```ts
export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
  },
  patchKey: 'dashboard',
  adminInterface: true,
})
```

This nests all published content under `dashboard` instead of `ui`, so the admin page would be at:

```bash
curl -L 'https://push.forward.computer/<process_id>/now/dashboard/admin'
```

#### Custom Admin Directory

By default, admin files are expected at `src/admin/`. To use a different location:

```ts
export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
  },
  adminInterface: { dir: 'src/my-admin' },
})
```

The admin interface can also be enabled per-process, like other options:

```ts
export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua', adminInterface: true },
    worker: { entry: 'src/worker.lua' },
  },
})
```

## AOS Module Build

By default, hyperengine outputs a single self-contained `process.lua`. If you want to build your process as a **module** for the [ao CLI](https://github.com/permaweb/aos) `build` command, add the `aos` option to your config:

```ts
import { defineConfig } from '@memetic-block/hyperengine'

export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
  },
  aos: {
    commit: 'ab1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9',
  },
})
```

When `aos` is set, the build changes for `type: 'process'` entries (the default):

1. **Clones the aos repo** at the specified commit from `https://github.com/permaweb/aos`
2. **Copies all `.lua` files** from the repo's `process/` directory into your output
3. **Wraps your bundle as a module** — your bundled Lua is output as `{processName}.lua` instead of `process.lua`, wrapped so all side effects (handler registration, etc.) execute on `require()`
4. **Injects `require(".{processName}")`** into the copied `process.lua` after the last `Handlers.add`/`Handlers.append` call
5. **Generates a `config.yml`** with ao-dev-cli options (memory settings, WASM target, compute limit, module format)

Entries with `type: 'module'` are **not affected** by the `aos` option — they always produce a raw bundle output without any AOS integration.

The result is a directory structure compatible with `ao cli build`:

```
dist/
  main/
    main.lua          ← your bundled code (as a module)
    process.lua       ← from aos repo, with require("main") injected
    config.yml        ← ao-dev-cli configuration
    handlers.lua      ← other aos process files
    ...
```

With multiple processes, each gets its own subdirectory:

```
dist/
  main/
    main.lua
    process.lua
    config.yml
  worker/
    worker.lua
    process.lua
    config.yml
```

### Excluding Default Modules

The default aos `process.lua` loads several built-in modules (crypto, SQLite, etc.) via `require()`. If your process doesn't need them, use `exclude` to strip those `require()` calls from the copied `process.lua`:

```ts
export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
  },
  aos: {
    commit: 'ab1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9',
    exclude: ['.crypto.init', '.sqlite'],
  },
})
```

Module names use dot-path syntax matching how they appear in Lua `require()` calls. A leading dot is optional — `'crypto.init'` and `'.crypto.init'` both match `require(".crypto.init")`.

The `.lua` files themselves are still copied to the output directory; only the `require()` lines are removed so the modules are never loaded at runtime.

### AOS Build Options

Customize memory, WASM target, and other ao-dev-cli settings:

```ts
export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
  },
  aos: {
    commit: 'ab1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9',
    stack_size: 3_145_728,        // 3MiB (default)
    initial_memory: 4_194_304,    // 4MiB — includes stack + heap (default)
    maximum_memory: 1_073_741_824, // 1GiB (default)
    target: 32,                    // wasm32 (default) or 64 for wasm64
    compute_limit: '9000000000000', // publishing compute limit (default)
    module_format: 'wasm32-unknown-emscripten-metering', // auto-derived from target
  },
})
```

The generated `config.yml`:

```yml
# ao-dev-cli options
stack_size: 3145728
initial_memory: 4194304
maximum_memory: 1073741824
target: 32
# extra info
aos_git_hash: 'ab1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9'
compute_limit: '9000000000000'
module_format: 'wasm32-unknown-emscripten-metering'
```

### Caching

The cloned aos repo is cached at `node_modules/.cache/hyperengine/aos-{commit}` so subsequent builds don't re-clone. Delete this directory to force a fresh clone.

### Requirements

- **git** must be available on your PATH
- The `commit` value must be a valid 7-40 character hex commit hash

## Deploy & Publish

Hyperengine includes built-in commands for deploying AO processes and publishing modules to Arweave.

Deploy spawns new AO processes and loads your bundled Lua into them. Publish uploads WASM or Lua modules to Arweave for use as custom AO modules.

### Deploy Configuration

Configure deploy settings in your config file and/or via environment variables:

```ts
import { defineConfig } from '@memetic-block/hyperengine'

export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
  },
  deploy: {
    wallet: './wallet.json',
    // hyperbeamUrl: 'https://your-hyperbeam-node.example',
    // scheduler: '_GQ33BkPtZrqxA84vM8Zk-N2aO0toNNu_C-l-rawrBA',
    // authority: '_GQ33BkPtZrqxA84vM8Zk-N2aO0toNNu_C-l-rawrBA',
    // spawnTags: [{ name: 'App-Name', value: 'my-app' }],
    // actionTags: [{ name: 'X-Custom', value: 'value' }],
  },
})
```

| Option         | Env Variable    | Description                                                    | Default |
|----------------|-----------------|----------------------------------------------------------------|---------|
| `wallet`       | `WALLET_PATH`   | Path to Arweave JWK wallet file                                | —       |
| `hyperbeamUrl` | `HYPERBEAM_URL` | HyperBEAM node URL (sets CU, MU, and Gateway)                  | —       |
| `scheduler`    |                 | Scheduler address for `ao.spawn()`                              | `_GQ33BkPtZrqxA84vM8Zk-N2aO0toNNu_C-l-rawrBA` |
| `authority`    |                 | Authority address for spawned process                           | falls back to `scheduler` |
| `spawnTags`    |                 | Extra `{ name, value }` tags included on spawn messages         | `[]`    |
| `actionTags`   |                 | Extra `{ name, value }` tags included on Eval action messages   | `[]`    |

When `hyperbeamUrl` is set and neither `scheduler` nor `authority` are provided, Hyperengine will automatically fetch the node's wallet address from `<hyperbeamUrl>/~meta@1.0/info/address` and use it for both values.

Environment variables take precedence over config file values.

### .env File Support

Hyperengine automatically loads a `.env` file from your project root when running any CLI command. Variables defined in `.env` are applied to `process.env` **without overwriting** existing environment variables.

```bash
# .env
WALLET_PATH=./wallet.json
HYPERBEAM_URL=https://your-hyperbeam-node.example
```

A `.env.example` file is included in scaffolded projects (via `npx hyperengine create`). Copy it to `.env` and fill in your values:

```bash
cp .env.example .env
```

> **Note:** `.env` is already included in the generated `.gitignore` — never commit wallet paths or secrets.

### Single-File Process Deploy

For standard processes (`type: 'process'` or default), deploy:

1. Spawns a new AO process using the standard AOS module (`ISShJH1ij-hPPt9St5UFFr_8Ys3Kj5cyg7zrMGt7H9s`)
2. Sends an `Eval` message with the bundled Lua source from `dist/`
3. Confirms the Eval succeeded

```bash
# Build first
npx hyperengine build

# Deploy all processes
npx hyperengine deploy

# Deploy a specific process
npx hyperengine deploy --process main

# See detailed step-by-step logs
npx hyperengine deploy --verbose
```

### Module Build Deploy

For processes with a published WASM module (built via `ao build`):

1. Looks up the `moduleId` from config or the deploy manifest
2. Spawns a new AO process using that custom module
3. No Eval step — the code is baked into the WASM module

You must run `hyperengine publish` before deploying a WASM module build.

Alternatively, set the `moduleId` directly in config:

```ts
export default defineConfig({
  processes: {
    main: {
      entry: 'src/process.lua',
      moduleId: 'your-published-module-tx-id',
    },
  },
  deploy: { wallet: './wallet.json' },
})
```

> **Note:** Processes with `type: 'module'` (dynamic read modules) are **publish-only** — they cannot be deployed as standalone AO processes. Use `hyperengine publish` for these.

### Publishing Modules

The `publish` command uploads build artifacts to Arweave via [Turbo](https://ardrive.io/turbo/). It requires `@ardrive/turbo-sdk` to be installed in your project:

```bash
npm install @ardrive/turbo-sdk
```

If the package is not installed, the `publish` command will prompt you to install it.

- **WASM modules**: Looks for `dist/<name>/process.wasm` (output of `ao build`), uploads with `Content-Type: application/wasm` and `Type: Module` tags
- **Lua modules**: Uploads the bundled `.lua` file from `dist/` with `Content-Type: text/x-lua` and `Type: Module` tags

```bash
# Publish all processes
npx hyperengine publish

# Publish a specific process
npx hyperengine publish --process reader

# See upload details and timing
npx hyperengine publish --verbose
```

The returned transaction ID is saved to the deploy manifest and used as the `moduleId` for subsequent `deploy` commands.

### Deploy Manifest

Deploy and publish results are saved to `.hyperengine/deploy.json` in your project root:

```json
{
  "processes": {
    "main": {
      "processId": "abc123...",
      "moduleId": "ISShJH1ij-hPPt9St5UFFr_8Ys3Kj5cyg7zrMGt7H9s",
      "deployedAt": "2025-01-15T10:30:00.000Z"
    }
  }
}
```

This file is gitignored by default in scaffolded projects. The manifest allows `deploy` to automatically find `moduleId` values set by a prior `publish`.

## Project Structure

```
my-ao-app/
  hyperengine.config.ts
  package.json
  src/
    process.lua
    worker.lua
    admin/              ← optional, scaffolded with --admin
      template.html
      styles.css
      admin.js
      init.lua
      pages/
        index.mu
        templates.mu
        publish.mu
        acl.mu
        preview.mu
      partials/
        header.mu
        nav.mu
        footer.mu
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
hyperengine create [name] [--typescript] [--esm] [--admin] [--directory <dir>]

# Bundle all processes
hyperengine build

# Bundle a specific process
hyperengine build --process main

# Generate a .rockspec from config
hyperengine rockspec

# Publish modules to Arweave
hyperengine publish
hyperengine publish --process reader

# Deploy (spawn) AO processes
hyperengine deploy
hyperengine deploy --process main

# Smoke-test compiled WASM modules with aoloader
hyperengine smoke
hyperengine smoke main
hyperengine smoke --all

# Verbose output (config, file ops, network status, timing)
hyperengine deploy --verbose
hyperengine publish --verbose

# Debug output (all verbose info + payloads and raw responses)
hyperengine deploy --debug
```

| Command    | Description                                                      |
|------------|------------------------------------------------------------------|
| `create`   | Scaffold a new hyperengine project                               |
| `build`    | Resolve Lua modules, inline templates, emit `.lua` bundles       |
| `rockspec` | Generate a `.rockspec` file from luarocks config                 |
| `publish`  | Upload WASM or Lua modules to Arweave via Turbo                  |
| `deploy`   | Spawn AO processes and load bundled Lua code                     |
| `smoke`    | Smoke-test compiled ao WASM modules locally via aoloader         |

Options for all commands:

- `-r, --root <dir>` — Project root directory (default: `.`)
- `-p, --process <name>` — Target a specific process (build/publish/deploy)
- `--all` — Smoke-test all ao module processes (smoke)

Options for `deploy` and `publish`:

- `-v, --verbose` — Show detailed operation logs (config resolution, file operations, network status codes, step timing)
- `-D, --debug` — Show all details including payloads and raw responses (implies `--verbose`)

Verbose and debug output is written to **stderr**, keeping stdout clean for machine-parseable output. Lines are prefixed with `[verbose]` or `[debug]`.

Options for `create`:

- `-T, --typescript` — Include TypeScript support (adds `type="module"` to script tags for Vite processing)
- `-e, --esm` — Enable ESM mode for inlined scripts
- `-a, --admin` — Include admin interface (adds `runtime.handlers` and `runtime.adminInterface` to config)
- `-d, --directory <dir>` — Parent directory for the new project (default: `.`)

## Configuration

```ts
import { defineConfig } from '@memetic-block/hyperengine'

export default defineConfig({
  // Named process definitions (required)
  processes: {
    main: {
      entry: 'src/process.lua',    // Lua entry point (required)
      type: 'process',             // 'process' (default) or 'module'
      outFile: 'process.lua',      // Output filename (default: derived from entry)
      templates: { /* ... */ },     // Per-process template overrides
      luarocks: { /* ... */ },      // Per-process luarocks overrides
      patchKey: 'ui',              // Per-process patchKey override
      stateKey: 'hyperengine_state', // Per-process stateKey override
      runtime: true,                // Per-process runtime override
    },
  },

  // Output directory (default: "dist")
  outDir: 'dist',

  // Top-level key for publishing rendered templates to patch@1.0 (default: "ui")
  // Nesting under this key prevents raw HTML in message headers
  patchKey: 'ui',

  // Key under which template and ACL state is synced to patch@1.0 (default: "hyperengine_state")
  // State is nested as { templates: ..., acl: ... } under this key
  stateKey: 'hyperengine_state',

  // Shared template defaults
  templates: {
    extensions: ['.html', '.htm', '.tmpl', '.mustache', '.mst', '.mu', '.stache'],
    dir: 'src/templates',           // Auto-detected from entry dir by default
    vite: true,                     // or { plugins, css, resolve, define, external, esm }
  },

  // Shared luarocks defaults (optional — only needed for additional Lua dependencies)
  luarocks: {
    dependencies: { 'lua-cjson': '2.1.0-1' },
    luaVersion: '5.3',
  },

  // Runtime template management module (default: disabled)
  runtime: true,               // or { handlers: true, adminInterface: true }

  // Build as an aos module (default: disabled)
  aos: {
    commit: 'abc123...',       // Git commit hash of permaweb/aos repo
    stack_size: 3_145_728,     // Stack size in bytes (default: 3MiB)
    initial_memory: 4_194_304, // Initial memory in bytes (default: 4MiB)
    maximum_memory: 1_073_741_824, // Max memory in bytes (default: 1GiB)
    target: 32,                // wasm32 (default) or 64 for wasm64
    compute_limit: '9000000000000', // Compute limit for publishing
    module_format: 'wasm32-unknown-emscripten-metering', // Auto-derived from target
    exclude: ['.crypto.init'], // Strip require() calls for unused default modules
  },

  // Deploy & publish configuration (default: disabled)
  deploy: {
    wallet: './wallet.json',    // Path to Arweave JWK wallet (or set WALLET_PATH env var)
    hyperbeamUrl: 'https://...', // HyperBEAM node URL (or set HYPERBEAM_URL env var)
    scheduler: '_GQ33BkPtZrqxA84vM8Zk-N2aO0toNNu_C-l-rawrBA', // Scheduler address
    authority: '_GQ33BkPtZrqxA84vM8Zk-N2aO0toNNu_C-l-rawrBA', // Authority address (falls back to scheduler)
    spawnTags: [{ name: 'App-Name', value: 'my-app' }], // Extra spawn tags
    actionTags: [],             // Extra Eval action tags
  },
})
```

### Full Config Interface

```ts
interface HyperengineConfig {
  /** Lua entry point */
  entry: string

  /** Artifact type: 'process' (default) or 'module' (dynamic read module, skips aos build) */
  type?: 'process' | 'module'

  /** Published module transaction ID (for WASM module builds, set after publish) */
  moduleId?: string

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
      /** Dependencies to treat as external (not bundled/inlined by Rollup).
       *  Use { name, url } objects to also inject a <script type="importmap">. */
      external?: (string | RegExp | { name: string; url: string })[]
      /** Preserve type="module" on inlined scripts and protect pre-existing inline scripts from Vite */
      esm?: boolean
    }
  }

  luarocks?: {
    /** Dependencies, e.g. { lustache: '1.3.1-0' } */
    dependencies?: Record<string, string>
    /** Lua version for the rockspec (default: '5.3') */
    luaVersion?: string
  }

  /** Include the hyperengine runtime module for post-deploy template management */
  runtime?: boolean | {
    /** Auto-register AO message handlers for template CRUD */
    handlers?: boolean
    /** Enable admin UI for template & ACL management. true for defaults, or pass options.
     *  Implicitly enables handlers when set. */
    adminInterface?: boolean | {
      /** Path key used when publishing to patch@1.0 (default: 'admin') */
      path?: string
      /** Directory containing admin source files (default: 'src/admin') */
      dir?: string
    }
  }

  /** Build as an aos module — clones the aos repo and outputs your bundle as a require()'d module */
  aos?: {
    /** Git commit hash of the permaweb/aos repo to clone */
    commit: string
    /** Stack size in bytes (default: 3145728 = 3MiB) */
    stack_size?: number
    /** Initial memory in bytes — includes stack + heap (default: 4194304 = 4MiB) */
    initial_memory?: number
    /** Maximum memory in bytes (default: 1073741824 = 1GiB) */
    maximum_memory?: number
    /** WASM target: 32 or 64 (default: 32) */
    target?: 32 | 64
    /** Compute limit for publishing (default: '9000000000000') */
    compute_limit?: string
    /** Module format (default: derived from target, e.g. 'wasm32-unknown-emscripten-metering') */
    module_format?: string
    /** Dot-path module names to exclude from the aos process.lua (e.g. ['.crypto.init']) */
    exclude?: string[]
  }

  /** Deploy & publish configuration */
  deploy?: {
    /** Path to Arweave JWK wallet file (or set WALLET_PATH env var) */
    wallet?: string
    /** HyperBEAM node URL — sets CU, MU, and Gateway (or set HYPERBEAM_URL env var) */
    hyperbeamUrl?: string
    /** Scheduler address for ao.spawn() (default: '_GQ33BkPtZrqxA84vM8Zk-N2aO0toNNu_C-l-rawrBA') */
    scheduler?: string
    /** Authority address for spawned process (falls back to scheduler) */
    authority?: string
    /** Extra { name, value } tags included on spawn messages */
    spawnTags?: Array<{ name: string; value: string }>
    /** Extra { name, value } tags included on Eval action messages */
    actionTags?: Array<{ name: string; value: string }>
  }
}
```

## Testing

```bash
npm test          # run tests once
npm run test:watch # run tests in watch mode
```

TypeScript tests (vitest) cover the bundler pipeline, configuration, deployment, and code generation framework. Lua runtime behavior (handler logic, ACL, template rendering, state management) is tested separately with [busted](https://lunarmodules.github.io/busted/) and is not covered in the TypeScript test suite.

## How It Works

1. **Resolve** — Parses `require()` calls from the entry Lua file, recursively resolves modules from the project source tree and `lua_modules/` (luarocks local install)
2. **Collect** — Globs template files, reads them, wraps each in Lua long-string brackets. If the admin interface is enabled, collects admin HTML files from `src/admin/` (prefixed with `admin/`) and merges them with user templates.
3. **Render** *(optional)* — If `templates.vite` is enabled, processes `.html` templates through Vite: escapes Mustache syntax, runs Vite build to compile and inline CSS/JS assets, restores Mustache syntax. Admin templates are processed alongside user templates in a single Vite build.
4. **Emit** — Wraps each module in a function, generates a `require`-compatible loader, bundles the [lustache](https://github.com/Olivine-Labs/lustache) template engine, inlines templates as a virtual `require('templates')` module, optionally includes the `require('hyperengine')` runtime module, and appends the entry point source
5. **Output** — Writes a single flat `.lua` file to `outDir/outFile`
6. **AOS Module** *(optional)* — If `aos` is configured, wraps the bundle as a Lua module, clones the aos repo at the specified commit, copies its `process/` Lua files to the output directory, injects `require("{processName}")` into the aos `process.lua`, and generates a `config.yml` with ao-dev-cli build options

The output is self-contained and runs in AO's Lua runtime without external dependencies.

## Rockspec Generation

The `hyperengine rockspec` command generates a `.rockspec` file from the `luarocks` section of your config. This is useful when you have additional Lua dependencies beyond the built-in lustache engine:

```bash
npx hyperengine rockspec
luarocks install --local --tree lua_modules my-app-0.1.0-1.rockspec
```

The bundler then resolves from `lua_modules/` to inline those dependencies into the final bundle.

## License

AGPLv3
