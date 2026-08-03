import { Worker, type ConnectionOptions } from 'bullmq'
import { PROJECT_DELETE_QUEUE_NAME, type DeleteProjectJobData } from '~~/lib/queue'
import { processProjectDeletion } from './processor'

export function createDeleteProjectWorker(connection: ConnectionOptions): Worker<DeleteProjectJobData> {
  const worker = new Worker<DeleteProjectJobData>(
    PROJECT_DELETE_QUEUE_NAME,
    async (job) => {
      console.log(`Processing project deletion job ${job.id}`)
      await processProjectDeletion(job.data)
      console.log(`Finished project deletion job ${job.id}`)
    },
    { connection, concurrency: 1 },
  )

  worker.on('completed', (job) => {
    console.log(`Delete job ${job.id} completed`)
  })

  worker.on('failed', (job, err) => {
    console.error(`Delete job ${job?.id} failed:`, err.message)
  })

  return worker
}
