import 'dotenv/config'
import { closeDb } from '~~/lib/db'
import { redisConnection, redisUrl, runtimeDir, dockerExecutorUrl } from './config'
import { createDeploymentWorker } from './deployment/worker'
import { createDeleteProjectWorker } from './delete-project/worker'
import { WORKER_LOCK_DURATION_MS, WORKER_LOCK_RENEW_MS } from './options'

const deploymentWorker = createDeploymentWorker(redisConnection)
const deleteWorker = createDeleteProjectWorker(redisConnection)

console.log('Providentra worker started')
console.log(`  Redis: ${redisUrl}`)
console.log(`  Runtime dir: ${runtimeDir}`)
console.log(`  Docker executor: ${dockerExecutorUrl}`)
console.log(
  `  Job lock: ${WORKER_LOCK_DURATION_MS / 1000}s (renew every ${WORKER_LOCK_RENEW_MS / 1000}s)`,
)

async function shutdown() {
  console.log('Shutting down worker...')
  await Promise.all([deploymentWorker.close(), deleteWorker.close()])
  await closeDb()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
