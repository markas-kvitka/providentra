import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import Docker from 'dockerode'
import tar from 'tar-fs'
import { getComposeProjectName } from '../lib/slug'
import { dockerSocket } from './config'
import { getProjectPaths, getProjectRootDir } from './paths'

export interface DeployRequest {
  slug: string
  appPort: number
  enablePostgres: boolean
  environmentVariables: Array<{ key: string; value: string }>
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

function containerNames(slug: string) {
  const projectName = getComposeProjectName(slug)
  return {
    projectName,
    app: `${projectName}-app`,
    postgres: `${projectName}-postgres`,
    network: `${projectName}-network`,
    postgresVolume: `${projectName}-postgres-data`,
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

async function ensurePostgres(
  docker: Docker,
  slug: string,
  names: ReturnType<typeof containerNames>,
  networkName: string,
  messages: string[],
): Promise<void> {
  const labels = managedLabels(slug)

  try {
    const existing = await docker.getContainer(names.postgres).inspect()
    if (existing.State.Running) {
      messages.push(`Postgres container ${names.postgres} already running`)
      return
    }
  } catch {
    // Create a new postgres container below.
  }

  await removeContainerIfExists(docker, names.postgres)

  try {
    await docker.getVolume(names.postgresVolume).inspect()
  } catch {
    await docker.createVolume({
      Name: names.postgresVolume,
      Labels: labels,
    })
  }

  const container = await docker.createContainer({
    name: names.postgres,
    Image: 'postgres:16-alpine',
    Env: [
      'POSTGRES_USER=app',
      'POSTGRES_PASSWORD=app',
      'POSTGRES_DB=app',
    ],
    Labels: labels,
    HostConfig: {
      RestartPolicy: { Name: 'unless-stopped' },
      Binds: [`${names.postgresVolume}:/var/lib/postgresql/data`],
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [networkName]: {
          Aliases: ['postgres'],
        },
      },
    },
    Healthcheck: {
      Test: ['CMD-SHELL', 'pg_isready -U app'],
      Interval: 5_000_000_000,
      Timeout: 5_000_000_000,
      Retries: 5,
    },
  })

  await container.start()
  messages.push(`Started postgres container ${names.postgres}`)
  await waitForHealthy(container)
}

async function createAppContainer(
  docker: Docker,
  slug: string,
  names: ReturnType<typeof containerNames>,
  config: DeployRequest,
  projectDir: string,
  hostProjectDir: string,
  networkName: string,
  messages: string[],
): Promise<void> {
  const labels = managedLabels(slug)
  const hasDockerfile = existsSync(join(projectDir, 'Dockerfile'))

  const environment = [
    `PORT=${config.appPort}`,
    ...(config.enablePostgres ? ['DATABASE_URL=postgresql://app:app@postgres:5432/app'] : []),
    ...config.environmentVariables.map(({ key, value }) => `${key}=${value}`),
  ]

  const portBinding = { [`${config.appPort}/tcp`]: [{ HostPort: String(config.appPort) }] }

  if (hasDockerfile) {
    const imageTag = `${names.projectName}-app:latest`
    messages.push(`Building image ${imageTag}`)
    await buildAppImage(docker, projectDir, imageTag, messages)

    const container = await docker.createContainer({
      name: names.app,
      Image: imageTag,
      Env: environment,
      Labels: labels,
      ExposedPorts: { [`${config.appPort}/tcp`]: {} },
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
    ExposedPorts: { [`${config.appPort}/tcp`]: {} },
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
  const names = containerNames(config.slug)
  const { projectDir, hostProjectDir } = getProjectPaths(config.slug)
  const messages: string[] = []

  if (!existsSync(projectDir)) {
    throw new Error(`Project directory not found: ${projectDir}`)
  }

  await ensureNetwork(docker, names.network)

  if (config.enablePostgres) {
    await ensurePostgres(docker, config.slug, names, names.network, messages)
  }

  await removeContainerIfExists(docker, names.app)
  await createAppContainer(
    docker,
    config.slug,
    names,
    config,
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
  const names = containerNames(slug)
  const messages: string[] = []

  for (const name of [names.app, names.postgres]) {
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
    try {
      const volume = docker.getVolume(names.postgresVolume)
      await volume.remove({ force: true })
      messages.push(`Removed volume ${names.postgresVolume}`)
    } catch {
      // Volume does not exist.
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
  const names = containerNames(slug)
  const chunks: string[] = []

  for (const name of [names.app, names.postgres]) {
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
