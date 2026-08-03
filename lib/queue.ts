export const DEPLOYMENT_QUEUE_NAME = 'deployments'
export const PROJECT_DELETE_QUEUE_NAME = 'project-deletions'

export interface DeploymentJobData {
  deploymentId: string
  projectId: string
}

export interface DeleteProjectJobData {
  projectId: string
}
