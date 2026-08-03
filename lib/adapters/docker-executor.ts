import { getComposeProjectName } from '../slug'
import { DockerExecutorClient, type DeploymentConfig, type DeploymentRunResult } from './docker-executor-client'

export type { DeploymentConfig, DeploymentRunResult }

export class DeploymentAdapter {
  private readonly client: DockerExecutorClient

  constructor(
    baseUrl: string,
    private readonly slug: string,
  ) {
    this.client = new DockerExecutorClient(baseUrl)
  }

  get composeProjectName(): string {
    return getComposeProjectName(this.slug)
  }

  async deploy(config: Omit<DeploymentConfig, 'slug'>): Promise<DeploymentRunResult> {
    return this.client.deploy({ slug: this.slug, ...config })
  }

  async down(options?: { removeVolumes?: boolean; purgeFiles?: boolean }): Promise<DeploymentRunResult | null> {
    return this.client.teardown(this.slug, options)
  }

  async logs(): Promise<string> {
    return this.client.logs(this.slug)
  }
}
