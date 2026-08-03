import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { CaddyAdapter } from './adapters/caddy'
import { DeploymentAdapter } from './adapters/docker-executor'
import { DockerExecutorClient } from './adapters/docker-executor-client'
import { getProjectDir } from './slug'

export interface ProjectCleanupTarget {
  slug: string
  domain: string
  hasManagedVolumes: boolean
}

export interface CaddyReloadConfig {
  caddyfilePath?: string
}

export async function cleanupProjectResources(
  project: ProjectCleanupTarget,
  runtimeDir: string,
  caddyConfigDir: string,
  dockerExecutorUrl: string,
  caddyReload: CaddyReloadConfig = {},
): Promise<void> {
  const projectDir = getProjectDir(runtimeDir, project.slug)
  const deploymentAdapter = new DeploymentAdapter(dockerExecutorUrl, project.slug)
  const caddyAdapter = new CaddyAdapter(caddyConfigDir, {
    reloader: new DockerExecutorClient(dockerExecutorUrl),
    caddyfilePath: caddyReload.caddyfilePath,
  })

  let filesPurged = false
  try {
    // The executor runs as root and mounts the runtime dir, so it can remove
    // container-created files (e.g. root-owned node_modules) that the worker
    // process cannot delete directly.
    await deploymentAdapter.down({ removeVolumes: project.hasManagedVolumes, purgeFiles: true })
    filesPurged = true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`Docker teardown failed for ${project.slug}: ${message}`)
  }

  try {
    await caddyAdapter.removeProxyConfig(project.domain)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`Caddy config removal failed for ${project.domain}: ${message}`)
  }

  if (!filesPurged && existsSync(projectDir)) {
    // Fallback when the executor could not purge the files itself. This may
    // fail for root-owned files, so it is best-effort and must not block
    // deletion of the project record.
    try {
      await rm(projectDir, { recursive: true, force: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`Failed to remove project directory ${projectDir}: ${message}`)
    }
  }
}
