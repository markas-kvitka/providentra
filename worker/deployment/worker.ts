import { Worker, type ConnectionOptions } from 'bullmq'
import { DEPLOYMENT_QUEUE_NAME, type DeploymentJobData } from '~~/lib/queue'
import { processDeployment } from './processor'

export function createDeploymentWorker(connection: ConnectionOptions): Worker<DeploymentJobData> {
  const worker = new Worker<DeploymentJobData>(
    DEPLOYMENT_QUEUE_NAME,
    async (job) => {
      console.log(`Processing deployment job ${job.id}`)
      await processDeployment(job.data)
      console.log(`Finished deployment job ${job.id}`)
    },
    { connection, concurrency: 1 },
  )

  worker.on('completed', (job) => {
    console.log(`Deployment job ${job.id} completed`)
  })

  worker.on('failed', (job, err) => {
    console.error(`Deployment job ${job?.id} failed:`, err.message)
  })

  return worker
}
