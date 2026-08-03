import { z } from 'zod'

const environmentVariablesSchema = z.array(
  z.object({
    key: z.string().min(1).max(255),
    value: z.string(),
  }),
)

/**
 * Zod's `.url()` accepts `https:/host` (URL parser normalizes it), but git does not —
 * it treats that as an SSH host named "https". Require an explicit `://` (or scp-like git@).
 */
export const gitRepositoryUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    (url) => /^(https|http|ssh):\/\//i.test(url) || /^git@[^\s:]+:[^\s]+$/.test(url),
    {
      message:
        'Repository URL must start with https://, http://, ssh://, or use git@host:path form',
    },
  )

export const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  gitRepositoryUrl: gitRepositoryUrlSchema,
  branch: z.string().min(1).max(255).default('main'),
  appPort: z.number().int().min(1).max(65535).default(3000),
  domain: z.string().min(1).max(255),
  enablePostgres: z.boolean().default(false),
  environmentVariables: environmentVariablesSchema.default([]),
})

export type CreateProjectBody = z.infer<typeof createProjectSchema>

export const updateProjectSchema = z.object({
  gitRepositoryUrl: gitRepositoryUrlSchema,
  branch: z.string().min(1).max(255),
  appPort: z.number().int().min(1).max(65535),
  domain: z.string().min(1).max(255),
  enablePostgres: z.boolean(),
  environmentVariables: environmentVariablesSchema,
})

export type UpdateProjectBody = z.infer<typeof updateProjectSchema>
