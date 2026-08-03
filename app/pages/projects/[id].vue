<script setup lang="ts">
import type {
  ProjectDetail,
  DeploymentSummary,
  DeploymentDetail,
  EnvironmentVariableInput,
  UpdateProjectInput,
} from '../../../shared/types'

const route = useRoute()
const projectId = route.params.id as string

interface ProjectResponse {
  project: ProjectDetail
  deployments: DeploymentSummary[]
}

interface EnvRow {
  key: string
  value: string
}

const { data, pending, error, refresh } = await useFetch<ProjectResponse>(`/api/projects/${projectId}`)

const deploying = ref(false)
const deleting = ref(false)
const deleteConfirmSlug = ref('')
const deleteError = ref('')
const retryingId = ref<string | null>(null)
const deployError = ref('')
const configError = ref('')
const savingConfig = ref(false)
const selectedDeploymentId = ref<string | null>(null)
const deploymentLogs = ref<DeploymentDetail | null>(null)
const polling = ref(false)

const editForm = reactive({
  gitRepositoryUrl: '',
  branch: '',
  appPort: 3000,
  domain: '',
  enablePostgres: false,
})
const envRows = ref<EnvRow[]>([{ key: '', value: '' }])

const terminalStatuses = ['running', 'failed']
const latestDeployment = computed(() => data.value?.deployments[0] ?? null)
const activeDeployment = computed(
  () => data.value?.deployments.find((d) => !terminalStatuses.includes(d.status)) ?? null,
)
const hasActiveDeployment = computed(() => activeDeployment.value !== null)
const isBusy = computed(
  () => deploying.value || polling.value || retryingId.value !== null || deleting.value || savingConfig.value,
)

function envPayload(rows: EnvRow[]): EnvironmentVariableInput[] {
  return rows.filter((r) => r.key.trim()).map((r) => ({ key: r.key.trim(), value: r.value }))
}

function sameEnv(
  a: EnvironmentVariableInput[],
  b: EnvironmentVariableInput[],
): boolean {
  if (a.length !== b.length) return false
  return a.every((item, i) => item.key === b[i]?.key && item.value === b[i]?.value)
}

const configDirty = computed(() => {
  const project = data.value?.project
  if (!project) return false

  return (
    editForm.gitRepositoryUrl !== project.gitRepositoryUrl
    || editForm.branch !== project.branch
    || editForm.appPort !== project.appPort
    || editForm.domain !== project.domain
    || editForm.enablePostgres !== project.enablePostgres
    || !sameEnv(envPayload(envRows.value), project.environmentVariables)
  )
})

function syncEditForm(project: ProjectDetail) {
  editForm.gitRepositoryUrl = project.gitRepositoryUrl
  editForm.branch = project.branch
  editForm.appPort = project.appPort
  editForm.domain = project.domain
  editForm.enablePostgres = project.enablePostgres
  envRows.value = project.environmentVariables.length
    ? project.environmentVariables.map((e) => ({ key: e.key, value: e.value }))
    : [{ key: '', value: '' }]
}

watch(
  () => data.value?.project,
  (project) => {
    if (project) syncEditForm(project)
  },
  { immediate: true },
)

watch(
  latestDeployment,
  (dep) => {
    if (dep && !selectedDeploymentId.value) {
      selectedDeploymentId.value = dep.id
    }
  },
  { immediate: true },
)

function addEnvRow() {
  envRows.value.push({ key: '', value: '' })
}

function removeEnvRow(index: number) {
  envRows.value.splice(index, 1)
  if (!envRows.value.length) {
    envRows.value.push({ key: '', value: '' })
  }
}

function resetConfig() {
  if (data.value?.project) {
    syncEditForm(data.value.project)
    configError.value = ''
  }
}

async function loadDeploymentLogs(deploymentId: string) {
  selectedDeploymentId.value = deploymentId
  deploymentLogs.value = await $fetch<DeploymentDetail>(`/api/deployments/${deploymentId}`)

  if (!terminalStatuses.includes(deploymentLogs.value.status) && !polling.value) {
    await pollDeployment()
  }
}

watch(selectedDeploymentId, async (id) => {
  if (id) await loadDeploymentLogs(id)
})

async function pollDeployment() {
  if (!selectedDeploymentId.value || polling.value) return
  polling.value = true

  let attempts = 0
  const maxAttempts = 120

  while (attempts < maxAttempts) {
    const detail = await $fetch<DeploymentDetail>(`/api/deployments/${selectedDeploymentId.value}`)
    deploymentLogs.value = detail

    if (terminalStatuses.includes(detail.status)) {
      await refresh()
      break
    }

    await new Promise((r) => setTimeout(r, 2000))
    attempts++
  }

  polling.value = false
}

async function saveConfig() {
  if (!data.value || !configDirty.value) return

  configError.value = ''
  savingConfig.value = true

  const body: UpdateProjectInput = {
    gitRepositoryUrl: editForm.gitRepositoryUrl.trim(),
    branch: editForm.branch.trim(),
    appPort: editForm.appPort,
    domain: editForm.domain.trim(),
    enablePostgres: editForm.enablePostgres,
    environmentVariables: envPayload(envRows.value),
  }

  try {
    await $fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      body,
    })
    await refresh()
  } catch (e: unknown) {
    configError.value = getErrorMessage(e)
    throw e
  } finally {
    savingConfig.value = false
  }
}

async function deploy() {
  deployError.value = ''
  deploying.value = true

  try {
    if (configDirty.value) {
      await saveConfig()
    }

    const result = await $fetch<{ deploymentId: string }>(`/api/projects/${projectId}/deploy`, {
      method: 'POST',
    })

    selectedDeploymentId.value = result.deploymentId
    await refresh()
    await pollDeployment()
  } catch (e: unknown) {
    deployError.value = getErrorMessage(e)
  } finally {
    deploying.value = false
  }
}

async function retryDeployment(deploymentId: string) {
  deployError.value = ''
  retryingId.value = deploymentId

  try {
    if (configDirty.value) {
      await saveConfig()
    }

    await $fetch(`/api/deployments/${deploymentId}/retry`, { method: 'POST' })
    selectedDeploymentId.value = deploymentId
    await refresh()
    await pollDeployment()
  } catch (e: unknown) {
    deployError.value = getErrorMessage(e)
  } finally {
    retryingId.value = null
  }
}

function getErrorMessage(e: unknown): string {
  const fetchError = e as {
    data?: { statusMessage?: string; data?: { fieldErrors?: Record<string, string[]> } }
    statusMessage?: string
  }
  const fieldErrors = fetchError.data?.data?.fieldErrors
  if (fieldErrors) {
    const first = Object.values(fieldErrors).flat()[0]
    if (first) return first
  }
  return fetchError.data?.statusMessage ?? fetchError.statusMessage ?? 'Request failed'
}

async function deleteProject() {
  if (!data.value || deleteConfirmSlug.value !== data.value.project.slug) return

  deleteError.value = ''
  deleting.value = true

  try {
    await $fetch(`/api/projects/${projectId}`, { method: 'DELETE' })
    await navigateTo('/projects')
  } catch (e: unknown) {
    deleteError.value = getErrorMessage(e)
  } finally {
    deleting.value = false
  }
}

function statusBadgeClass(status: string) {
  return `badge badge-${status}`
}

onMounted(async () => {
  if (selectedDeploymentId.value) {
    await loadDeploymentLogs(selectedDeploymentId.value)
  }
})
</script>

<template>
  <div class="container">
    <div v-if="pending" class="empty-state">Loading project...</div>
    <div v-else-if="error || !data" class="error">Project not found.</div>
    <template v-else>
      <div class="header">
        <div>
          <h1>{{ data.project.name }}</h1>
          <p style="margin: 0.25rem 0 0; color: #71717a; font-size: 0.875rem">{{ data.project.slug }}</p>
        </div>
        <button class="btn btn-primary" :disabled="isBusy || hasActiveDeployment" @click="deploy">
          {{ isBusy ? 'Deploying...' : 'Deploy' }}
        </button>
      </div>

      <div v-if="deployError" class="error">{{ deployError }}</div>
      <div v-if="configError" class="error">{{ configError }}</div>

      <div v-if="latestDeployment?.status === 'failed'" class="error">
        <strong>Latest deployment failed</strong>
        <p style="margin: 0.5rem 0 0">{{ latestDeployment.errorMessage }}</p>
        <button
          class="btn btn-secondary"
          style="margin-top: 0.75rem"
          :disabled="isBusy || hasActiveDeployment"
          @click="retryDeployment(latestDeployment.id)"
        >
          {{ retryingId === latestDeployment.id ? 'Retrying...' : 'Retry Deployment' }}
        </button>
      </div>

      <div class="card">
        <div class="config-header">
          <h2 style="margin: 0; font-size: 1rem">Configuration</h2>
          <div v-if="configDirty" class="config-actions">
            <button
              class="btn btn-secondary"
              style="padding: 0.25rem 0.75rem; font-size: 0.75rem"
              :disabled="isBusy || hasActiveDeployment"
              @click="resetConfig"
            >
              Reset
            </button>
            <button
              class="btn btn-primary"
              style="padding: 0.25rem 0.75rem; font-size: 0.75rem"
              :disabled="isBusy || hasActiveDeployment"
              @click="saveConfig"
            >
              {{ savingConfig ? 'Saving...' : 'Save Changes' }}
            </button>
          </div>
        </div>

        <p class="config-hint">
          Name and slug are fixed. Repo, branch, port, domain, Postgres, and env vars can be edited;
          changes apply on the next deploy.
        </p>

        <div class="form-group">
          <label for="git">Git Repository URL</label>
          <input
            id="git"
            v-model="editForm.gitRepositoryUrl"
            type="text"
            required
            placeholder="https://github.com/user/repo.git"
            :disabled="isBusy || hasActiveDeployment"
          />
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="branch">Branch</label>
            <input
              id="branch"
              v-model="editForm.branch"
              required
              placeholder="main"
              :disabled="isBusy || hasActiveDeployment"
            />
          </div>
          <div class="form-group">
            <label for="port">App Port</label>
            <input
              id="port"
              v-model.number="editForm.appPort"
              type="number"
              min="1"
              max="65535"
              required
              :disabled="isBusy || hasActiveDeployment"
            />
          </div>
        </div>

        <div class="form-group">
          <label for="domain">Domain / Subdomain</label>
          <input
            id="domain"
            v-model="editForm.domain"
            required
            placeholder="myapp.localhost"
            :disabled="isBusy || hasActiveDeployment"
          />
        </div>

        <div class="form-group toggle">
          <input
            id="postgres"
            v-model="editForm.enablePostgres"
            type="checkbox"
            :disabled="isBusy || hasActiveDeployment"
          />
          <label for="postgres">Include PostgreSQL service</label>
        </div>

        <div class="form-group">
          <label>Environment Variables</label>
          <div v-for="(row, i) in envRows" :key="i" class="env-row">
            <input v-model="row.key" placeholder="KEY" :disabled="isBusy || hasActiveDeployment" />
            <input v-model="row.value" placeholder="value" :disabled="isBusy || hasActiveDeployment" />
            <button
              type="button"
              class="btn btn-secondary"
              :disabled="isBusy || hasActiveDeployment"
              @click="removeEnvRow(i)"
            >
              Remove
            </button>
          </div>
          <button
            type="button"
            class="btn btn-secondary"
            style="margin-top: 0.5rem"
            :disabled="isBusy || hasActiveDeployment"
            @click="addEnvRow"
          >
            Add Variable
          </button>
        </div>
      </div>

      <div v-if="latestDeployment" class="card">
        <h2 style="margin: 0 0 1rem; font-size: 1rem">Latest Deployment</h2>
        <dl class="detail-grid">
          <dt>Status</dt>
          <dd><span :class="statusBadgeClass(latestDeployment.status)">{{ latestDeployment.status }}</span></dd>
          <dt>Commit</dt>
          <dd>{{ latestDeployment.commitSha ?? '—' }}</dd>
          <dt>Started</dt>
          <dd>{{ latestDeployment.startedAt ? new Date(latestDeployment.startedAt).toLocaleString() : '—' }}</dd>
          <dt v-if="latestDeployment.errorMessage">Error</dt>
          <dd v-if="latestDeployment.errorMessage" style="color: #f87171">{{ latestDeployment.errorMessage }}</dd>
        </dl>
      </div>

      <div class="card">
        <h2 style="margin: 0 0 1rem; font-size: 1rem">Deployment History</h2>
        <div v-if="!data.deployments.length" style="color: #71717a; font-size: 0.875rem">No deployments yet.</div>
        <table v-else class="table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Commit</th>
              <th>Created</th>
              <th>Error</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="dep in data.deployments" :key="dep.id">
              <td><span :class="statusBadgeClass(dep.status)">{{ dep.status }}</span></td>
              <td>{{ dep.commitSha?.slice(0, 7) ?? '—' }}</td>
              <td>{{ new Date(dep.createdAt).toLocaleString() }}</td>
              <td>
                <span v-if="dep.errorMessage" class="error-text" :title="dep.errorMessage">
                  {{ dep.errorMessage }}
                </span>
                <span v-else style="color: #71717a">—</span>
              </td>
              <td class="table-actions">
                <button
                  class="btn btn-secondary"
                  style="padding: 0.25rem 0.5rem; font-size: 0.75rem"
                  @click="loadDeploymentLogs(dep.id)"
                >
                  View Logs
                </button>
                <button
                  v-if="dep.status === 'failed'"
                  class="btn btn-secondary"
                  style="padding: 0.25rem 0.5rem; font-size: 0.75rem"
                  :disabled="isBusy || hasActiveDeployment"
                  @click="retryDeployment(dep.id)"
                >
                  {{ retryingId === dep.id ? 'Retrying...' : 'Retry' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="deploymentLogs" class="card">
        <h2 style="margin: 0 0 1rem; font-size: 1rem">
          Deployment Logs
          <span :class="statusBadgeClass(deploymentLogs.status)" style="margin-left: 0.5rem">
            {{ deploymentLogs.status }}
          </span>
        </h2>
        <div v-if="deploymentLogs.status === 'failed' && deploymentLogs.errorMessage" class="error" style="margin-bottom: 1rem">
          <strong>Deployment failed</strong>
          <p style="margin: 0.5rem 0 0">{{ deploymentLogs.errorMessage }}</p>
          <button
            class="btn btn-secondary"
            style="margin-top: 0.75rem"
            :disabled="isBusy || hasActiveDeployment"
            @click="retryDeployment(deploymentLogs.id)"
          >
            {{ retryingId === deploymentLogs.id ? 'Retrying...' : 'Retry Deployment' }}
          </button>
        </div>
        <div class="logs">{{ deploymentLogs.logs || 'No logs yet.' }}</div>
      </div>

      <div class="card danger-zone">
        <h2 style="margin: 0 0 0.5rem; font-size: 1rem">Danger Zone</h2>
        <p style="margin: 0 0 1rem; color: #71717a; font-size: 0.875rem">
          Permanently delete this project, its containers, proxy config, and deployment history.
          <span v-if="data.project.enablePostgres"> PostgreSQL data will also be removed.</span>
        </p>

        <div v-if="hasActiveDeployment && activeDeployment" class="notice">
          Deletion is unavailable while a deployment is in progress
          (<span :class="statusBadgeClass(activeDeployment.status)">{{ activeDeployment.status }}</span>).
          Wait for it to complete, then try again.
        </div>

        <template v-else>
          <div v-if="deleteError" class="error" style="margin-bottom: 1rem">{{ deleteError }}</div>
          <div class="form-group" style="max-width: 20rem">
            <label for="delete-confirm">Type <strong>{{ data.project.slug }}</strong> to confirm</label>
            <input
              id="delete-confirm"
              v-model="deleteConfirmSlug"
              type="text"
              placeholder="Project slug"
              :disabled="deleting"
            />
          </div>
          <button
            class="btn btn-danger"
            :disabled="deleting || deleteConfirmSlug !== data.project.slug"
            @click="deleteProject"
          >
            {{ deleting ? 'Deleting...' : 'Delete Project' }}
          </button>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.config-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.config-actions {
  display: flex;
  gap: 0.5rem;
}

.config-hint {
  margin: 0 0 1.25rem;
  color: #71717a;
  font-size: 0.8125rem;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 8rem;
  gap: 1rem;
}

@media (max-width: 640px) {
  .form-row {
    grid-template-columns: 1fr;
  }

  .config-header {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
