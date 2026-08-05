<script setup lang="ts">
import type { ProjectSummary } from '../../../shared/types'

const { data: projects, pending, error, refresh } = await useFetch<ProjectSummary[]>('/api/projects')

function statusBadgeClass(status: string | null) {
  if (!status) return 'badge'
  return `badge badge-${status}`
}
</script>

<template>
  <div class="container">
    <div class="header">
      <h1>Projects</h1>
      <NuxtLink to="/projects/new" class="btn btn-primary">New Project</NuxtLink>
    </div>

    <div v-if="pending" class="empty-state">Loading projects...</div>
    <div v-else-if="error" class="error">Failed to load projects.</div>
    <div v-else-if="!projects?.length" class="card empty-state">
      <p>No projects yet.</p>
      <NuxtLink to="/projects/new" class="btn btn-primary" style="margin-top: 1rem">Create your first project</NuxtLink>
    </div>
    <div v-else class="card" style="padding: 0; overflow: hidden">
      <table class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Domain</th>
            <th>Branch</th>
            <th>Status</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="project in projects" :key="project.id">
            <td>
              <NuxtLink :to="`/projects/${project.id}`">{{ project.name }}</NuxtLink>
            </td>
            <td>{{ project.domain }}</td>
            <td>{{ project.branch }}</td>
            <td>
              <span :class="statusBadgeClass(project.latestDeploymentStatus)">
                {{ project.latestDeploymentStatus ?? 'none' }}
              </span>
            </td>
            <td>{{ new Date(project.createdAt).toLocaleDateString() }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
