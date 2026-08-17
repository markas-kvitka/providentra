import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import Docker from 'dockerode'
import tar from 'tar-fs'
import {
  collectAppInjectEnv,
  isManagedServiceKey,
  listManagedRecipes,
  managedContainerName,
  managedVolumeName,
  tryGetManagedRecipe,
  type ManagedServiceKey,
  type ManagedServiceRecipe,
} from '../lib/managed-services'
import { getComposeProjectName } from '../lib/slug'
import { dockerSocket } from './config'
import { getProjectPaths, getProjectRootDir } from './paths'

export type DeployServiceSpec =
  | {
      type: 'app'
      name: string
      port: number
      environmentVariables: Array<{ key: string; value: string }>
    }
  | {
      type: ManagedServiceKey
      name: string
    }

export interface DeployRequest {
  slug: string
  services: DeployServiceSpec[]
}

export interface DeployResult {
  messages: string[]
}

const MANAGED_LABEL = 'com.providentra.managed'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getDocker(): Docker {
  return new Docker({ socketPath: dockerSocket })
}

function projectNames(slug: string) {
  const projectName = getComposeProjectName(slug)
  return {
    projectName,
    app: `${projectName}-app`,
    network: `${projectName}-network`,
  }
}

function managedLabels(slug: string): Record<string, string> {
  return {
    [MANAGED_LABEL]: 'true',
    'com.providentra.slug': slug,
  }
}

async function ensureNetwork(docker: Docker, networkName: string): Promise<void> {
  try {
    await docker.getNetwork(networkName).inspect()
  } catch {
    await docker.createNetwork({
      Name: networkName,
      Driver: 'bridge',
      Labels: { [MANAGED_LABEL]: 'true' },
    })
  }
}

async function removeContainerIfExists(docker: Docker, name: string): Promise<void> {
  try {
    const container = docker.getContainer(name)
    await container.stop({ t: 10 }).catch(() => undefined)
    await container.remove({ force: true })
  } catch {
    // Container does not exist.
  }
}

async function waitForHealthy(container: Docker.Container, timeoutMs = 120_000): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const inspection = await container.inspect()
    const health = inspection.State.Health?.Status

    if (health === 'healthy') {
      return
    }

    if (inspection.State.Status === 'running' && !inspection.Config.Healthcheck) {
      return
    }

    if (inspection.State.Status === 'exited' || inspection.State.Status === 'dead') {
      throw new Error(`Container ${inspection.Name} exited before becoming healthy`)
    }

    await sleep(2_000)
  }

  throw new Error('Timed out waiting for container health check')
}

async function buildAppImage(
  docker: Docker,
  projectDir: string,
  imageTag: string,
  messages: string[],
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    docker.buildImage(
      tar.pack(projectDir, {
        ignore: (name) => name === 'node_modules' || name.startsWith('.git'),
      }),
      { t: imageTag, dockerfile: 'Dockerfile' },
      (error, stream) => {
        if (error || !stream) {
          reject(error ?? new Error('Docker build returned no stream'))
          return
        }

        docker.modem.followProgress(stream, (progressError) => {
          if (progressError) {
            reject(progressError)
            return
          }
          resolve()
        }, (event) => {
          if (event.stream) {
            messages.push(event.stream.trimEnd())
          }
        })
      },
    )
  })
}

async function ensureManagedService(
  docker: Docker,
  slug: string,
  projectName: string,
  networkName: string,
  recipe: ManagedServiceRecipe,
  messages: string[],
): Promise<void> {
  const labels = managedLabels(slug)
  const containerName = managedContainerName(projectName, recipe)

  try {
    const existing = await docker.getContainer(containerName).inspect()
    if (existing.State.Running) {
      messages.push(`${recipe.label} container ${containerName} already running`)
      return
    }
  } catch {
    // Create a new managed container below.
  }

  await removeContainerIfExists(docker, containerName)

  const volumeName = managedVolumeName(projectName, recipe)
  if (recipe.volume && volumeName) {
    try {
      await docker.getVolume(volumeName).inspect()
    } catch {
      await docker.createVolume({
        Name: volumeName,
        Labels: labels,
      })
    }
  }

  const container = await docker.createContainer({
    name: containerName,
    Image: recipe.image,
    Env: recipe.env,
    Labels: labels,
    HostConfig: {
      RestartPolicy: { Name: 'unless-stopped' },
      ...(recipe.volume && volumeName
        ? { Binds: [`${volumeName}:${recipe.volume.mountPath}`] }
        : {}),
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [networkName]: {
          Aliases: [recipe.networkAlias],
        },
      },
    },
    ...(recipe.healthcheck
      ? {
          Healthcheck: {
            Test: recipe.healthcheck.test,
            Interval: recipe.healthcheck.intervalNs,
            Timeout: recipe.healthcheck.timeoutNs,
            Retries: recipe.healthcheck.retries,
          },
        }
      : {}),
  })

  await container.start()
  messages.push(`Started ${recipe.label} container ${containerName}`)
  await waitForHealthy(container)
}

async function removeManagedService(
  docker: Docker,
  projectName: string,
  recipe: ManagedServiceRecipe,
  messages: string[],
): Promise<void> {
  const containerName = managedContainerName(projectName, recipe)
  try {
    const container = docker.getContainer(containerName)
    await container.stop({ t: 10 }).catch(() => undefined)
    await container.remove({ force: true })
    messages.push(`Removed ${recipe.label} container ${containerName}`)
  } catch {
    // Container does not exist.
  }

  const volumeName = managedVolumeName(projectName, recipe)
  if (!volumeName) return

  try {
    await docker.getVolume(volumeName).remove({ force: true })
    messages.push(`Removed ${recipe.label} volume ${volumeName}`)
  } catch {
    // Volume does not exist.
  }
}

async function pruneUnusedManagedServices(
  docker: Docker,
  projectName: string,
  desiredTypes: ReadonlySet<ManagedServiceKey>,
  messages: string[],
): Promise<void> {
  for (const recipe of listManagedRecipes()) {
    if (desiredTypes.has(recipe.key)) continue
    await removeManagedService(docker, projectName, recipe, messages)
  }
}

async function createAppContainer(
  docker: Docker,
  slug: string,
  names: ReturnType<typeof projectNames>,
  app: Extract<DeployServiceSpec, { type: 'app' }>,
  managedTypes: ManagedServiceKey[],
  projectDir: string,
  hostProjectDir: string,
  networkName: string,
  messages: string[],
): Promise<void> {
  const labels = managedLabels(slug)
  const hasDockerfile = existsSync(join(projectDir, 'Dockerfile'))

  const environment = [
    `PORT=${app.port}`,
    ...collectAppInjectEnv(managedTypes),
    ...app.environmentVariables.map(({ key, value }) => `${key}=${value}`),
  ]

  const portBinding = { [`${app.port}/tcp`]: [{ HostPort: String(app.port) }] }

  if (hasDockerfile) {
    const imageTag = `${names.projectName}-app:latest`

    const container = await docker.createContainer({
      name: names.app,
      Image: imageTag,
      Env: environment,
      Labels: labels,
      ExposedPorts: { [`${app.port}/tcp`]: {} },
      HostConfig: {
        RestartPolicy: { Name: 'unless-stopped' },
        PortBindings: portBinding,
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [networkName]: {},
        },
      },
    })

    await container.start()
    messages.push(`Started app container ${names.app}`)
    return
  }

  const container = await docker.createContainer({
    name: names.app,
    Image: 'node:22-alpine',
    WorkingDir: '/app',
    Cmd: ['sh', '-c', 'npm install && npm start'],
    Env: environment,
    Labels: labels,
    ExposedPorts: { [`${app.port}/tcp`]: {} },
    HostConfig: {
      RestartPolicy: { Name: 'unless-stopped' },
      Binds: [`${hostProjectDir}:/app`],
      PortBindings: portBinding,
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [networkName]: {},
      },
    },
  })

  await container.start()
  messages.push(`Started app container ${names.app} (node fallback)`)
}

export async function deployProject(config: DeployRequest): Promise<DeployResult> {
  const docker = getDocker()
  const names = projectNames(config.slug)
  const { projectDir, hostProjectDir } = getProjectPaths(config.slug)
  const messages: string[] = []

  if (!existsSync(projectDir)) {
    throw new Error(`Project directory not found: ${projectDir}`)
  }

  const app = config.services.find((service): service is Extract<DeployServiceSpec, { type: 'app' }> => {
    return service.type === 'app'
  })
  if (!app) {
    throw new Error('Deploy request must include an app service')
  }

  const managedTypes = config.services
    .map((service) => service.type)
    .filter((type): type is ManagedServiceKey => isManagedServiceKey(type))
  const desiredManagedTypes = new Set(managedTypes)

  await ensureNetwork(docker, names.network)

  for (const type of managedTypes) {
    const recipe = tryGetManagedRecipe(type)
    if (!recipe) {
      throw new Error(`Unknown managed service type: ${type}`)
    }
    await ensureManagedService(
      docker,
      config.slug,
      names.projectName,
      names.network,
      recipe,
      messages,
    )
  }

  await pruneUnusedManagedServices(docker, names.projectName, desiredManagedTypes, messages)

  const hasDockerfile = existsSync(join(projectDir, 'Dockerfile'))
  if (hasDockerfile) {
    const imageTag = `${names.projectName}-app:latest`
    messages.push(`Building image ${imageTag}`)
    await buildAppImage(docker, projectDir, imageTag, messages)
  }

  await removeContainerIfExists(docker, names.app)
  await createAppContainer(
    docker,
    config.slug,
    names,
    app,
    managedTypes,
    projectDir,
    hostProjectDir,
    names.network,
    messages,
  )

  return { messages }
}

export async function teardownProject(
  slug: string,
  options?: { removeVolumes?: boolean; purgeFiles?: boolean },
): Promise<DeployResult> {
  const docker = getDocker()
  const names = projectNames(slug)
  const messages: string[] = []
  const managed = listManagedRecipes()

  const containerNames = [
    names.app,
    ...managed.map((recipe) => managedContainerName(names.projectName, recipe)),
  ]

  for (const name of containerNames) {
    try {
      const container = docker.getContainer(name)
      await container.stop({ t: 10 }).catch(() => undefined)
      await container.remove({ force: true })
      messages.push(`Removed container ${name}`)
    } catch {
      // Container does not exist.
    }
  }

  try {
    const network = docker.getNetwork(names.network)
    await network.remove()
    messages.push(`Removed network ${names.network}`)
  } catch {
    // Network does not exist.
  }

  if (options?.removeVolumes) {
    for (const recipe of managed) {
      const volumeName = managedVolumeName(names.projectName, recipe)
      if (!volumeName) continue
      try {
        const volume = docker.getVolume(volumeName)
        await volume.remove({ force: true })
        messages.push(`Removed volume ${volumeName}`)
      } catch {
        // Volume does not exist.
      }
    }
  }

  if (options?.purgeFiles) {
    const projectRootDir = getProjectRootDir(slug)
    if (existsSync(projectRootDir)) {
      // Runs as root inside the executor, so it can remove files created by
      // container processes (e.g. root-owned node_modules from `npm install`).
      await rm(projectRootDir, { recursive: true, force: true })
      messages.push(`Removed project directory ${projectRootDir}`)
    }
  }

  return { messages }
}

export async function getProjectLogs(slug: string): Promise<string> {
  const docker = getDocker()
  const names = projectNames(slug)
  const chunks: string[] = []

  const containerNames = [
    names.app,
    ...listManagedRecipes().map((recipe) => managedContainerName(names.projectName, recipe)),
  ]

  for (const name of containerNames) {
    try {
      const container = docker.getContainer(name)
      const logBuffer = await container.logs({
        stdout: true,
        stderr: true,
        tail: 200,
        timestamps: false,
      })
      const text = logBuffer.toString('utf-8').trim()
      if (text) {
        chunks.push(`=== ${name} ===\n${text}`)
      }
    } catch {
      // Container does not exist.
    }
  }

  return chunks.join('\n\n')
}
