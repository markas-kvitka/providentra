import 'dotenv/config'
import { closeDb } from '~~/lib/db'
import { redisConnection, redisUrl, runtimeDir, dockerExecutorUrl } from './config'
import { createDeploymentWorker } from './deployment/worker'
import { createDeleteProjectWorker } from './delete-project/worker'

const deploymentWorker = createDeploymentWorker(redisConnection)
const deleteWorker = createDeleteProjectWorker(redisConnection)

console.log('Providentra worker started')
console.log(`  Redis: ${redisUrl}`)
console.log(`  Runtime dir: ${runtimeDir}`)
console.log(`  Docker executor: ${dockerExecutorUrl}`)

async function shutdown() {
  console.log('Shutting down worker...')
  await Promise.all([deploymentWorker.close(), deleteWorker.close()])
  await closeDb()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
