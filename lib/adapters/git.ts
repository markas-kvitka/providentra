import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import simpleGit, { type SimpleGit } from 'simple-git'

export interface GitCloneResult {
  commitSha: string
  commitMessage: string
}

export class GitAdapter {
  private git: SimpleGit

  constructor(private readonly repoDir: string) {
    this.git = simpleGit()
  }

  async cloneOrPull(repositoryUrl: string, branch: string): Promise<GitCloneResult> {
    await mkdir(dirname(this.repoDir), { recursive: true })

    if (existsSync(this.repoDir)) {
      const repoGit = simpleGit(this.repoDir)
      await repoGit.fetch('origin', branch)
      await repoGit.checkout(branch)
      await repoGit.pull('origin', branch)
    } else {
      await this.git.clone(repositoryUrl, this.repoDir, ['--branch', branch, '--single-branch'])
    }

    const repoGit = simpleGit(this.repoDir)
    const log = await repoGit.log({ maxCount: 1 })
    const latest = log.latest

    return {
      commitSha: latest?.hash ?? 'unknown',
      commitMessage: latest?.message ?? '',
    }
  }
}
