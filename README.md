# Providentra

A self-hosted "Vercel-lite" deployment platform. Define projects via a Nuxt control panel, trigger deployments, and run apps on the same machine as Docker containers with Caddy as a reverse proxy.

## Architecture

```
┌─────────────┐     ┌──────────┐     ┌─────────────┐
│  Nuxt App   │────▶│  Redis   │◀────│   Worker    │
│  (UI + API) │     │ (BullMQ) │     │  (deploys)  │
└──────┬──────┘     └──────────┘     └──────┬──────┘
       │                                      │
       ▼                                      ▼
┌─────────────┐                    ┌──────────────────┐
│ PostgreSQL  │                    │ Docker Executor  │
│  (metadata) │                    │ (Docker Engine)  │
└─────────────┘                    └────────┬─────────┘
                                            │
                                   ┌────────┴─────────┐
                                   │                  │
                                   ▼                  ▼
                          ┌──────────────┐   ┌──────────────────┐
                          │ App / DB     │   │      Caddy       │
                          │ containers   │   │ (reverse proxy)  │
                          └──────────────┘   └──────────────────┘
```

- **Nuxt app** — control panel UI and REST API (Better Auth email/password sessions)
- **Worker** — clones/pulls repos, calls the Docker executor, writes Caddy site configs
- **BullMQ + Redis** — job queue between API and worker (deploy + project deletion)
- **PostgreSQL** — users/sessions (Better Auth), projects, deployments, and first-class services (app, postgres, …)
- **Docker executor** — privileged HTTP service with access to the Docker socket; builds/runs the project's service set via Dockerode
- **Caddy** — routes domains to deployed app ports on the host

A **Project** is a namespace owned by a **User**. Under the hood it owns **Services** (today: one `web` app and an optional `postgres`). The control panel UI still presents a simple single-app form with a PostgreSQL checkbox; the API maps that onto the service model. All project and deployment APIs are scoped to the signed-in user.

Managed add-ons (Postgres today; Redis recipe ready) are defined in [`lib/managed-services.ts`](lib/managed-services.ts). The executor looks up image, volumes, healthchecks, and app env injection from that catalog — not hardcoded per service in deploy logic.

Platform infrastructure (Postgres, Redis, Caddy, docker-executor) runs via `docker-compose.yml`. Deployed apps are managed directly through the Docker Engine API — not via generated Compose files.

## Prerequisites

- Node.js 20+ (`.nvmrc` pins 24)
- pnpm 9+ (`corepack enable` to activate; repo uses pnpm 11)
- Docker and Docker Compose v2
- Git

## Quick Start

### 1. Start infrastructure

```bash
docker compose up -d
```

This starts PostgreSQL, Redis, Caddy, and the Docker executor (`http://127.0.0.1:3100`).

### 2. Configure environment

```bash
cp .env.example .env
```

Set `BETTER_AUTH_SECRET` to a long random string (at least 32 characters), e.g. `openssl rand -base64 32`. Also set `EXECUTOR_TOKEN` and `ENV_ENCRYPTION_KEY` (each: `openssl rand -base64 32`). Keep `BETTER_AUTH_URL=http://localhost:3000` for local development.

### 3. Install dependencies

```bash
pnpm install
```

### 4. Run database migrations

```bash
pnpm run db:migrate
```

> **Note:** The Better Auth migration clears existing projects so each project can require a `userId`. For a clean local reset you can also run `docker compose down -v` and migrate again.

### 5. Start the control panel

```bash
pnpm run dev
```

Open [http://localhost:3000](http://localhost:3000). Register an account (or sign in), then manage projects.

### 6. Start the deployment worker

In a separate terminal:

```bash
pnpm run worker
```

The worker must be running for deployments (and project deletions) to process.

## Usage

1. **Register / sign in** — create an account at `/register` or sign in at `/login`.
2. **Create a project** — go to Projects → New Project and fill in:
   - Project name
   - Git repository URL
   - Branch
   - App port (the port your app listens on; bound on the host)
   - Domain (e.g. `myapp.localhost` — add to `/etc/hosts` pointing to `127.0.0.1`)
   - Environment variables (optional)
   - PostgreSQL toggle (optional)

3. **Deploy** — open the project detail page and click **Deploy**.

4. **Monitor** — watch deployment status and logs on the project detail page. Failed deployments can be retried.

5. **Update / delete** — edit project settings from the detail page, or delete the project to tear down containers, volumes, and runtime files asynchronously.

## How Deployments Work

1. API creates a deployment record with status `queued` and enqueues a BullMQ job
2. Worker picks up the job and updates status through: `cloning` → `building` → `starting` → `running`
3. Worker loads the project's services, then clones/pulls the app service repo into `./runtime/projects/{slug}/repo`
4. Worker calls the Docker executor (`POST /deploy`) with the full service list, which:
   - Creates a managed Docker network for the project
   - Starts managed services (e.g. Postgres) when present
   - Builds the app from `Dockerfile` if present, otherwise runs `node:22-alpine` with `npm install && npm start` (bind-mounted repo)
   - Publishes the app container on the app service's configured host port
5. Worker writes a Caddy config snippet for the app service domain under `./runtime/caddy/`, then asks the executor to reload Caddy (`POST /caddy/reload` → Caddy admin API `/load` on the internal Docker network)
6. Worker updates each service row with container name and `running` status
7. On failure, the executor tears down project containers and status is set to `failed`

Project deletion is a separate BullMQ job: it stops containers, removes volumes/files when requested, clears Caddy config, and deletes the project row.

## Project Structure

```
providentra/
├── app/                       # Nuxt UI pages and layouts
├── server/
│   ├── api/                   # REST API routes
│   ├── queue/                 # BullMQ enqueue helpers
│   └── utils/                 # Zod validation
├── worker/
│   ├── deployment/            # Deploy job processor
│   └── delete-project/        # Project cleanup job processor
├── executor/                  # Docker + Caddy HTTP service (runs in Compose)
├── lib/
│   ├── auth.ts                # Better Auth server instance
│   ├── auth-client.ts         # Better Auth Vue client
│   ├── adapters/              # Git, Caddy, Docker executor client
│   ├── db.ts                  # Prisma client
│   ├── project-facade.ts      # Maps simple project DTOs ↔ services
│   ├── managed-services.ts    # Catalog of managed add-on recipes (postgres, redis, …)
│   ├── secrets.ts             # AES-GCM encrypt/decrypt for project env vars
│   ├── queue.ts               # Shared queue definitions
│   └── project-cleanup.ts     # Teardown helpers
├── shared/
│   └── types.ts               # Shared TypeScript types (UI-facing project shape)
├── runtime/
│   ├── projects/              # Cloned repos (gitignored)
│   └── caddy/                 # Per-project Caddy site snippets
├── prisma/                    # Schema, migrations, generated client
│                              # User owns Project; Project = namespace; Service = app/postgres/…
├── prisma.config.ts           # Prisma CLI config (loads .env, datasource URL)
├── docker-compose.yml         # Platform infrastructure
└── Caddyfile                  # Base Caddy config (imports runtime/caddy/*.caddy)
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| * | `/api/auth/*` | Better Auth handlers (sign-up, sign-in, session, sign-out) |
| GET | `/api/projects` | List projects for the signed-in user |
| POST | `/api/projects` | Create a project (owned by the signed-in user) |
| GET | `/api/projects/:id` | Project details + deployment history |
| PATCH | `/api/projects/:id` | Update project settings / env vars |
| DELETE | `/api/projects/:id` | Queue project deletion (async teardown) |
| POST | `/api/projects/:id/deploy` | Trigger a deployment |
| GET | `/api/deployments/:id` | Deployment status and logs |
| POST | `/api/deployments/:id/retry` | Retry a failed deployment |

All project and deployment routes require a valid Better Auth session. Unauthenticated requests receive `401`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgres://providentra:providentra@localhost:5432/providentra` | Platform database |
| `REDIS_URL` | `redis://localhost:6379` | Redis for BullMQ |
| `BETTER_AUTH_SECRET` | (required) | Secret for Better Auth encryption/hashing (≥32 chars) |
| `BETTER_AUTH_URL` | `http://localhost:3000` | Public base URL of the control panel |
| `EXECUTOR_TOKEN` | (required) | Shared bearer token for the Docker executor API (worker and Compose must match) |
| `ENV_ENCRYPTION_KEY` | (required) | Base64-encoded 32-byte AES-256-GCM key for project env vars at rest |
| `RUNTIME_DIR` | `./runtime` | Working directory for cloned repos and Caddy snippets |
| `CADDY_CONFIG_DIR` | `./runtime/caddy` | Per-project Caddy site config output |
| `CADDYFILE_PATH` | `./Caddyfile` | Base Caddyfile the worker forwards to the executor on reload |
| `DOCKER_EXECUTOR_URL` | `http://127.0.0.1:3100` | Docker executor HTTP API (used by worker / control plane; published on loopback only) |
| `CADDY_ADMIN_URL` | `http://caddy:2019` | Caddy admin API address the **executor** uses (internal Docker network; not published to the host) |
| `EXECUTOR_PORT` | `3100` | Port when running the executor via `pnpm run executor` |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Docker socket path used by the executor |
| `RUNTIME_HOST_DIR` | (set by Compose) | Absolute host path for bind mounts when the executor runs inside Docker |
| `NUXT_PORT` | `3000` | Control panel port |

## Prisma configuration

Database connection for CLI commands (`migrate`, `studio`, etc.) is configured in `prisma.config.ts` at the project root. It loads `.env` via `dotenv` and passes `DATABASE_URL` to the Prisma CLI.

The app runtime (`lib/db.ts`, worker) reads `DATABASE_URL` from `process.env` directly — make sure `.env` exists (copy from `.env.example`).

## Troubleshooting

### `db:migrate` fails with P1001 (can't reach database)

1. Ensure Postgres is running: `sudo docker compose up -d`
2. Verify port 5432 is published to the host:
   ```bash
   sudo docker ps --format 'table {{.Names}}\t{{.Ports}}' | grep providentra-db
   ```
   You should see `0.0.0.0:5432->5432/tcp`. If the PORTS column is empty, recreate the container:
   ```bash
   sudo docker compose up -d --force-recreate postgres
   ```
3. Confirm `.env` has `DATABASE_URL=postgres://providentra:providentra@localhost:5432/providentra`

### `Environment variable not found: DATABASE_URL`

Copy the example env file: `cp .env.example .env`

### Deployments stay queued

Confirm the worker is running (`pnpm run worker`) and Redis is healthy (`docker compose ps`).

### Executor / Docker errors during deploy

Confirm the docker-executor container is up and healthy:

```bash
docker compose ps docker-executor
curl -s http://127.0.0.1:3100/health
```

The executor listens on loopback only (`127.0.0.1:3100`). Deploy/teardown/logs require `Authorization: Bearer $EXECUTOR_TOKEN` (health is open for Compose checks). Ensure `.env` has matching `EXECUTOR_TOKEN` for the worker and Compose.

The executor needs access to `/var/run/docker.sock` and the `./runtime` volume.

### Env vars fail to decrypt

Confirm `ENV_ENCRYPTION_KEY` is set and is a base64-encoded 32-byte key (`openssl rand -base64 32`). Changing the key after encrypting values will break decrypt until project env vars are re-saved.

## Deployed App Requirements

- If the repo has a `Dockerfile`, it is used to build the app image
- Without a `Dockerfile`, a fallback `node:22-alpine` container runs `npm install && npm start` with the repo bind-mounted
- The app should listen on the port configured in the project settings (`PORT` is injected)
- When PostgreSQL is enabled (a `postgres` service under the project), `DATABASE_URL=postgresql://app:app@postgres:5432/app` is injected and the DB is reachable as hostname `postgres` on the project network
- Add `*.localhost` entries to `/etc/hosts` for local domain routing

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm run dev` | Start Nuxt dev server |
| `pnpm run build` | Generate Prisma client and build Nuxt for production |
| `pnpm run preview` | Preview the production Nuxt build |
| `pnpm run worker` | Start deployment / deletion worker |
| `pnpm run executor` | Run the Docker executor locally (Compose is preferred) |
| `pnpm run db:generate` | Generate Prisma client |
| `pnpm run db:migrate` | Apply pending migrations |
| `pnpm run db:push` | Push schema changes without migration files |
| `pnpm run db:studio` | Open Prisma Studio |
| `pnpm run typecheck` | Generate Nuxt types and run TypeScript checks |

## Local Domain Setup

Add entries to `/etc/hosts` for your project domains:

```
127.0.0.1 myapp.localhost
127.0.0.1 api.localhost
```

Caddy listens on port 80 and proxies to the app's configured port on the host (`host.docker.internal`). Automatic HTTPS is currently disabled (`auto_https off`).

## Future Enhancements

- Accounts / organizations (shared project ownership, invites, roles)
- GitHub integration (webhooks, OAuth)
- SSL/TLS via Caddy automatic HTTPS
- Multi-server deployments
- Rollback to previous deployment
- Build caching
