<template>
  <div>
    <header class="site-header">
      <div class="container header-inner">
        <NuxtLink to="/" class="logo">Providentra</NuxtLink>
        <nav>
          <NuxtLink to="/projects">Projects</NuxtLink>
          <NuxtLink to="/projects/new" class="nav-new">+ New Project</NuxtLink>
        </nav>
      </div>
    </header>
    <main>
      <slot />
    </main>
  </div>
</template>

<style scoped>
.site-header {
  border-bottom: 1px solid #2a2d3a;
  background: #1a1d27;
}

.header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 1rem;
  padding-bottom: 1rem;
}

.logo {
  font-size: 1.125rem;
  font-weight: 700;
  color: #e4e4e7;
  text-decoration: none;
}

nav {
  display: flex;
  gap: 1.5rem;
  align-items: center;
}

nav a {
  font-size: 0.875rem;
  color: #a1a1aa;
  text-decoration: none;
}

nav a:hover,
nav a.router-link-active {
  color: #e4e4e7;
}

.nav-new {
  color: #60a5fa !important;
}
</style>
