# Providentra

A self-hosted "Vercel-lite" deployment platform. Define projects via a Nuxt control panel, trigger deployments, and run apps on the same machine using Docker Compose with Caddy as a reverse proxy.

## Architecture

```
┌─────────────┐     ┌──────────┐     ┌─────────────┐
│  Nuxt App   │────▶│  Redis   │◀────│   Worker    │
│  (UI + API) │     │ (BullMQ) │     │  (deploys)  │
└──────┬──────┘     └──────────┘     └──────┬──────┘
       │                                      │
       ▼                                      ▼
┌─────────────┐                    ┌──────────────────┐
│ PostgreSQL  │                    │ Docker Compose   │
│  (metadata) │                    │ (deployed apps)  │
└─────────────┘                    └──────────────────┘
                                              │
                                              ▼
                                     ┌──────────────────┐
                                     │      Caddy       │
                                     │ (reverse proxy)  │
                                     └──────────────────┘
```

- **Nuxt app** — control panel UI and REST API
- **Worker** — separate process that clones repos, builds images, and starts containers
- **BullMQ + Redis** — job queue between API and worker
- **PostgreSQL** — projects, deployments, env vars, services
- **Docker Compose** — runs each deployed app (and optional Postgres)
- **Caddy** — routes domains to deployed app ports

## Prerequisites

- Node.js 20+
- pnpm 9+ (`corepack enable` to activate)
- Docker and Docker Compose v2
- Git

## Quick Start

### 1. Start infrastructure

```bash
docker compose up -d
```

This starts PostgreSQL, Redis, and Caddy.

### 2. Configure environment

```bash
cp .env.example .env
```

### 3. Install dependencies

```bash
pnpm install
```

### 4. Run database migrations

```bash
pnpm run db:migrate
```

### 5. Start the control panel

```bash
pnpm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 6. Start the deployment worker

In a separate terminal:

```bash
pnpm run worker
```

The worker must be running for deployments to process.

## Usage

1. **Create a project** — go to Projects → New Project and fill in:
   - Project name
   - Git repository URL
   - Branch
   - App port (the port your app listens on)
   - Domain (e.g. `myapp.localhost` — add to `/etc/hosts` pointing to `127.0.0.1`)
   - Environment variables (optional)
   - PostgreSQL toggle (optional)

2. **Deploy** — open the project detail page and click **Deploy**.

3. **Monitor** — watch deployment status and logs on the project detail page.

## How Deployments Work

1. API creates a deployment record with status `queued` and enqueues a BullMQ job
2. Worker picks up the job and updates status through: `cloning` → `building` → `starting` → `running`
3. Worker clones/pulls the repo into `./runtime/projects/{slug}/repo`
4. Worker generates `docker-compose.yml` with app service (and optional Postgres)
5. Worker runs `docker compose up -d --build`
6. Worker writes a Caddy config snippet for the project's domain, then asks the executor to reload Caddy (the executor POSTs the Caddyfile to Caddy's admin API `/load` over the internal Docker network)
7. On failure, containers are torn down and status is set to `failed`

## Project Structure

```
providentra/
├── app/                    # Nuxt UI pages and layouts
├── server/
│   ├── api/                # REST API routes
│   ├── adapters/
│   │   ├── git.ts          # Git clone/pull logic
│   │   └── docker-compose.ts  # Compose generation & Docker commands
│   ├── db/                 # Prisma client
│   └── queue/              # BullMQ queue helpers
├── worker/
│   └── index.ts            # Deployment worker entrypoint
├── shared/
│   └── types.ts            # Shared TypeScript types
├── runtime/
│   ├── projects/           # Cloned repos (gitignored)
│   └── caddy/              # Per-project Caddy configs
├── prisma/                 # Prisma schema and migrations
├── prisma.config.ts        # Prisma CLI config (loads .env, datasource URL)
├── docker-compose.yml      # Platform infrastructure
└── Caddyfile               # Base Caddy config
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List all projects |
| POST | `/api/projects` | Create a project |
| GET | `/api/projects/:id` | Project details + deployment history |
| POST | `/api/projects/:id/deploy` | Trigger a deployment |
| GET | `/api/deployments/:id` | Deployment status and logs |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgres://providentra:providentra@localhost:5432/providentra` | Platform database |
| `REDIS_URL` | `redis://localhost:6379` | Redis for BullMQ |
| `RUNTIME_DIR` | `./runtime` | Working directory for deployments |
| `CADDY_CONFIG_DIR` | `./runtime/caddy` | Caddy site config output |
| `CADDYFILE_PATH` | `./Caddyfile` | Base Caddyfile the worker forwards to the executor on reload |
| `CADDY_ADMIN_URL` | `http://caddy:2019` | Caddy admin API address the **executor** uses (internal Docker network; not published to the host) |

## Prisma configuration

Database connection for CLI commands (`migrate`, `studio`, etc.) is configured in `prisma.config.ts` at the project root. It loads `.env` via `dotenv` and passes `DATABASE_URL` to the Prisma CLI.

The app runtime (`server/db/index.ts`, worker) reads `DATABASE_URL` from `process.env` directly — make sure `.env` exists (copy from `.env.example`).

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

## Deployed App Requirements

- If the repo has a `Dockerfile`, it is used to build the app image
- Without a `Dockerfile`, a fallback Node.js image runs `npm install && npm start`
- The app should listen on the port configured in the project settings
- Add `*.localhost` entries to `/etc/hosts` for local domain routing

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm run dev` | Start Nuxt dev server |
| `pnpm run build` | Build for production |
| `pnpm run worker` | Start deployment worker |
| `pnpm run db:generate` | Create and apply a new Prisma migration (dev) |
| `pnpm run db:migrate` | Apply pending migrations (production) |
| `pnpm run db:push` | Push schema changes without migration files |
| `pnpm run db:studio` | Open Prisma Studio |

## Local Domain Setup

Add entries to `/etc/hosts` for your project domains:

```
127.0.0.1 myapp.localhost
127.0.0.1 api.localhost
```

Caddy listens on port 80 and proxies to the app's configured port on the host.

## Future Enhancements

- GitHub integration (webhooks, OAuth)
- SSL/TLS via Caddy automatic HTTPS
- Multi-server deployments
- Rollback to previous deployment
- Build caching
