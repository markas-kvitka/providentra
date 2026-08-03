import type { DeploymentStatus } from '~~/shared/types'

export const ACTIVE_DEPLOYMENT_STATUSES = [
  'queued',
  'cloning',
  'building',
  'starting',
] as const satisfies readonly DeploymentStatus[]
