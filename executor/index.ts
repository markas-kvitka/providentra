import 'dotenv/config'
import Docker from 'dockerode'
import { dockerSocket, runtimeDir, runtimeHostDir } from './config'
import { startExecutorServer } from './server'

async function verifyDockerAccess(): Promise<void> {
  const docker = new Docker({ socketPath: dockerSocket })

  try {
    await docker.ping()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Cannot access Docker at ${dockerSocket}: ${message}`)
    console.error(
      'Run the executor via platform compose instead of on the host:\n'
      + '  sudo docker compose up -d docker-executor\n'
      + 'Or add your user to the docker group and restart your shell:\n'
      + '  sudo usermod -aG docker $USER',
    )
    process.exit(1)
  }
}

console.log('Providentra docker executor starting')
console.log(`  Runtime dir: ${runtimeDir}`)
console.log(`  Runtime host dir: ${runtimeHostDir}`)

await verifyDockerAccess()
startExecutorServer()
