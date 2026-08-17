import { describe, expect, it, vi } from 'vitest'
import {
  WORKER_LOCK_DURATION_MS,
  WORKER_LOCK_RENEW_MS,
  attachLockDiagnostics,
  longRunningWorkerOptions,
} from '../../worker/options'

describe('longRunningWorkerOptions', () => {
  it('keeps a lock longer than BullMQ’s 30s default and renews inside that window', () => {
    const opts = longRunningWorkerOptions()

    expect(opts.lockDuration).toBe(WORKER_LOCK_DURATION_MS)
    expect(opts.lockDuration).toBeGreaterThan(30_000)
    expect(opts.lockRenewTime).toBe(WORKER_LOCK_RENEW_MS)
    expect(opts.lockRenewTime).toBeLessThan(opts.lockDuration!)
    expect(opts.skipLockRenewal).toBe(false)
    expect(opts.maxStalledCount).toBe(0)
    expect(opts.concurrency).toBe(1)
  })
})

describe('attachLockDiagnostics', () => {
  it('logs stalled and lock-renewal failures', () => {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    const worker = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        handlers.set(event, handler)
        return worker
      }),
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    attachLockDiagnostics(worker as never, 'Deployment')

    handlers.get('stalled')?.('job-1')
    handlers.get('lockRenewalFailed')?.(['job-2', 'job-3'])

    expect(error).toHaveBeenCalledWith(
      'Deployment job job-1 stalled (lock expired); it will not be retried',
    )
    expect(error).toHaveBeenCalledWith(
      'Deployment lock renewal failed for jobs: job-2, job-3',
    )

    error.mockRestore()
  })
})
