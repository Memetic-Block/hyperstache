import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export interface ProcessManifestEntry {
  processId?: string
  moduleId?: string
  deployedAt: string
}

export interface DeployManifest {
  processes: Record<string, ProcessManifestEntry>
}

function manifestPath(root: string): string {
  return join(root, '.hyperengine', 'deploy.json')
}

export async function readManifest(root: string): Promise<DeployManifest> {
  try {
    const raw = await readFile(manifestPath(root), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return { processes: {} }
  }
}

export async function writeManifest(root: string, manifest: DeployManifest): Promise<void> {
  const filePath = manifestPath(root)
  await mkdir(join(root, '.hyperengine'), { recursive: true })
  await writeFile(filePath, JSON.stringify(manifest, null, 2) + '\n')
}

export async function mergeManifest(
  root: string,
  updates: Record<string, Partial<ProcessManifestEntry>>,
): Promise<DeployManifest> {
  const manifest = await readManifest(root)
  for (const [name, entry] of Object.entries(updates)) {
    manifest.processes[name] = {
      ...manifest.processes[name],
      ...entry,
      deployedAt: new Date().toISOString(),
    }
  }
  await writeManifest(root, manifest)
  return manifest
}
