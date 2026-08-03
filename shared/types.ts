export type DeploymentStatus =
  | 'queued'
  | 'cloning'
  | 'building'
  | 'starting'
  | 'running'
  | 'failed'

export interface ProjectSummary {
  id: string
  name: string
  slug: string
  domain: string
  branch: string
  latestDeploymentStatus: DeploymentStatus | null
  createdAt: string
}

export interface EnvironmentVariableInput {
  key: string
  value: string
}

export interface CreateProjectInput {
  name: string
  gitRepositoryUrl: string
  branch: string
  appPort: number
  domain: string
  enablePostgres: boolean
  environmentVariables: EnvironmentVariableInput[]
}

export interface UpdateProjectInput {
  gitRepositoryUrl: string
  branch: string
  appPort: number
  domain: string
  enablePostgres: boolean
  environmentVariables: EnvironmentVariableInput[]
}

export interface ProjectDetail {
  id: string
  name: string
  slug: string
  gitRepositoryUrl: string
  branch: string
  appPort: number
  domain: string
  enablePostgres: boolean
  environmentVariables: EnvironmentVariableInput[]
  createdAt: string
  updatedAt: string
}

export interface DeploymentSummary {
  id: string
  status: DeploymentStatus
  commitSha: string | null
  errorMessage: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
}

export interface DeploymentDetail extends DeploymentSummary {
  logs: string
  projectId: string
}
