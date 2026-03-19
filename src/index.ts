export { defineConfig, loadConfig, resolveConfig } from './config.js'
export type { HyperstacheConfig, ResolvedConfig, ResolvedProcessConfig, ViteTemplateOptions, ExternalDep, ProcessConfig, TemplateConfig, LuarocksConfig, RuntimeConfig, AdminInterfaceConfig, AosConfig } from './config.js'

export { bundle, bundleProcess, renderTemplates, generateRuntimeSource, generateAdminSource, ensureAosRepo, copyAosProcessFiles, injectRequire, stripRequires } from './bundler/index.js'
export type { BundleResult } from './bundler/index.js'
export type { LuaModule, ResolveResult } from './bundler/resolver.js'
export type { TemplateEntry } from './bundler/templates.js'
export type { EscapeResult, ParsedExternals } from './bundler/vite-render.js'

export { generateRockspec, writeRockspec } from './rockspec.js'
