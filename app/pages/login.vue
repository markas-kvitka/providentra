<script setup lang="ts">
import { authClient } from '~~/lib/auth-client'

definePageMeta({
  layout: false,
})

const route = useRoute()
const email = ref('')
const password = ref('')
const submitting = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  submitting.value = true

  try {
    const result = await authClient.signIn.email({
      email: email.value,
      password: password.value,
    })

    if (result.error) {
      error.value = result.error.message ?? 'Sign in failed'
      return
    }

    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/projects'
    await navigateTo(redirect)
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Sign in failed'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card card">
      <h1 class="auth-brand">Providentra</h1>
      <p class="auth-subtitle">Sign in to your account</p>

      <div v-if="error" class="error">{{ error }}</div>

      <form @submit.prevent="submit">
        <div class="form-group">
          <label for="email">Email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            required
            autocomplete="email"
            placeholder="you@example.com"
          />
        </div>

        <div class="form-group">
          <label for="password">Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            required
            autocomplete="current-password"
            minlength="8"
            placeholder="••••••••"
          />
        </div>

        <button type="submit" class="btn btn-primary auth-submit" :disabled="submitting">
          {{ submitting ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>

      <p class="auth-footer">
        No account?
        <NuxtLink to="/register">Create one</NuxtLink>
      </p>
    </div>
  </div>
</template>
