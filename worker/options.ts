import type { Worker, WorkerOptions } from 'bullmq'

/**
 * Docker builds and git clones routinely run for minutes. BullMQ's default
 * lock is 30s; if renewal is delayed (event-loop block, Redis blip) the job
 * is marked stalled and can start a second deploy of the same project.
 */
export const WORKER_LOCK_DURATION_MS = 10 * 60 * 1000

/** Renew well inside the lock TTL so a live worker never drops a long job. */
export const WORKER_LOCK_RENEW_MS = 30 * 1000

export function longRunningWorkerOptions(): Pick<
  WorkerOptions,
  'concurrency' | 'lockDuration' | 'lockRenewTime' | 'skipLockRenewal' | 'maxStalledCount'
> {
  return {
    concurrency: 1,
    lockDuration: WORKER_LOCK_DURATION_MS,
    lockRenewTime: WORKER_LOCK_RENEW_MS,
    skipLockRenewal: false,
    maxStalledCount: 0,
  }
}

export function attachLockDiagnostics(worker: Worker, label: string): void {
  worker.on('stalled', (jobId) => {
    console.error(`${label} job ${jobId} stalled (lock expired); it will not be retried`)
  })
  worker.on('lockRenewalFailed', (jobIds) => {
    console.error(`${label} lock renewal failed for jobs: ${jobIds.join(', ')}`)
  })
}
