<script setup lang="ts">
interface EnvRow {
  key: string
  value: string
}

const form = reactive({
  name: '',
  gitRepositoryUrl: '',
  branch: 'main',
  appPort: 3000,
  domain: '',
  enablePostgres: false,
})

const envRows = ref<EnvRow[]>([{ key: '', value: '' }])
const submitting = ref(false)
const error = ref('')

function addEnvRow() {
  envRows.value.push({ key: '', value: '' })
}

function removeEnvRow(index: number) {
  envRows.value.splice(index, 1)
}

async function submit() {
  error.value = ''
  submitting.value = true

  try {
    const environmentVariables = envRows.value.filter((r) => r.key.trim())

    const result = await $fetch<{ id: string }>('/api/projects', {
      method: 'POST',
      body: {
        ...form,
        environmentVariables,
      },
    })

    await navigateTo(`/projects/${result.id}`)
  } catch (e: unknown) {
    const fetchError = e as {
      data?: { statusMessage?: string; data?: { fieldErrors?: Record<string, string[]> } }
      statusMessage?: string
    }
    const fieldError = Object.values(fetchError.data?.data?.fieldErrors ?? {}).flat()[0]
    error.value =
      fieldError
      ?? fetchError.data?.statusMessage
      ?? fetchError.statusMessage
      ?? 'Failed to create project'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="container">
    <div class="header">
      <h1>New Project</h1>
    </div>

    <div v-if="error" class="error">{{ error }}</div>

    <form class="card" @submit.prevent="submit">
      <div class="form-group">
        <label for="name">Project Name</label>
        <input id="name" v-model="form.name" required placeholder="my-app" />
      </div>

      <div class="form-group">
        <label for="git">Git Repository URL</label>
        <input
          id="git"
          v-model="form.gitRepositoryUrl"
          required
          type="text"
          placeholder="https://github.com/user/repo.git"
        />
      </div>

      <div class="form-group">
        <label for="branch">Branch</label>
        <input id="branch" v-model="form.branch" required placeholder="main" />
      </div>

      <div class="form-group">
        <label for="port">App Port</label>
        <input id="port" v-model.number="form.appPort" required type="number" min="1" max="65535" />
      </div>

      <div class="form-group">
        <label for="domain">Domain / Subdomain</label>
        <input id="domain" v-model="form.domain" required placeholder="myapp.localhost" />
      </div>

      <div class="form-group toggle">
        <input id="postgres" v-model="form.enablePostgres" type="checkbox" />
        <label for="postgres">Include PostgreSQL service</label>
      </div>

      <div class="form-group">
        <label>Environment Variables</label>
        <div v-for="(row, i) in envRows" :key="i" class="env-row">
          <input v-model="row.key" placeholder="KEY" />
          <input v-model="row.value" placeholder="value" />
          <button type="button" class="btn btn-secondary" @click="removeEnvRow(i)">Remove</button>
        </div>
        <button type="button" class="btn btn-secondary" style="margin-top: 0.5rem" @click="addEnvRow">
          Add Variable
        </button>
      </div>

      <div style="display: flex; gap: 0.75rem; margin-top: 1.5rem">
        <button type="submit" class="btn btn-primary" :disabled="submitting">
          {{ submitting ? 'Creating...' : 'Create Project' }}
        </button>
        <NuxtLink to="/projects" class="btn btn-secondary">Cancel</NuxtLink>
      </div>
    </form>
  </div>
</template>
