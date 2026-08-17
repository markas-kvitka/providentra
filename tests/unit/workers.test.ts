import { beforeEach, describe, expect, it, vi } from 'vitest'

const workerCtor = vi.hoisted(() => vi.fn())

vi.mock('bullmq', () => ({
  Worker: class {
    opts: unknown
    constructor(name: string, processor: unknown, opts: unknown) {
      workerCtor(name, processor, opts)
      this.opts = opts
    }

    on() {
      return this
    }
  },
}))

vi.mock('../../worker/deployment/processor', () => ({
  processDeployment: vi.fn(),
}))

vi.mock('../../worker/delete-project/processor', () => ({
  processProjectDeletion: vi.fn(),
}))

import { DEPLOYMENT_QUEUE_NAME, PROJECT_DELETE_QUEUE_NAME } from '../../lib/queue'
import { longRunningWorkerOptions } from '../../worker/options'
import { createDeploymentWorker } from '../../worker/deployment/worker'
import { createDeleteProjectWorker } from '../../worker/delete-project/worker'

describe('workers', () => {
  beforeEach(() => {
    workerCtor.mockClear()
  })

  const connection = { url: 'redis://localhost:6379', maxRetriesPerRequest: null }

  it('creates the deployment worker with long-running lock options', () => {
    createDeploymentWorker(connection)

    expect(workerCtor).toHaveBeenCalledWith(
      DEPLOYMENT_QUEUE_NAME,
      expect.any(Function),
      { connection, ...longRunningWorkerOptions() },
    )
  })

  it('creates the delete worker with long-running lock options', () => {
    createDeleteProjectWorker(connection)

    expect(workerCtor).toHaveBeenCalledWith(
      PROJECT_DELETE_QUEUE_NAME,
      expect.any(Function),
      { connection, ...longRunningWorkerOptions() },
    )
  })
})
