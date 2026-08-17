# Roadmap

Living plan for Providentra. Update this file when a feature lands — do not re-review the whole repo to remember what is next.

**How to update after a merge**

1. Tick the item (`- [x]`) and move it under [Shipped](#shipped) with a one-line note.
2. If the work changed an [architecture decision](#architecture-decisions), edit that section in the same PR.
3. If a bug in [Stabilize](#1-stabilize-the-deploy-path) is fixed, delete it from that list rather than leaving a stale warning.
4. Keep [Next](#next) ordered. New ideas go under [Later](#3-platform) or [Parking lot](#parking-lot), not the top of Next, unless they unblock deploy safety.

Last reviewed: 2026-08-17 on `feat/bullmq-lock-duration`.

## Product thesis

Self-hosted “Vercel-lite” on one machine: Nuxt control panel → BullMQ worker → Docker executor → Caddy.

A **Project** is a user-owned namespace. Under it, **Services** are the real units (today: one `web` app and an optional `postgres`). The control panel still presents a simple single-app form; the API maps that onto the service model via `lib/project-facade.ts`.

Treat the stack as a **single-operator local lab** until Stabilize is done. Do not share the host until a failed redeploy cannot tear down a live app, and long builds cannot stall the queue.

## Architecture decisions

Record the choice, not the debate. Change these only when the code changes.

| Decision | Current choice | Consequence |
|---|---|---|
| Control-plane UX | One web app + add-on checkboxes | Redis/second app need schema + API + UI, not just a catalog entry |
| Runtime model | Multi-service (Project owns Services) | Executor and `lib/managed-services.ts` already look up recipes |
| Deploy mutation | In-place: retag `:latest`, replace the running set | No rollback; failure teardown is catastrophic |
| App routing | Caddy → `host.docker.internal:{appPort}` | Host port clashes; apps bound on `0.0.0.0` |
| Auth | Better Auth email/password, per-user projects | Orgs/roles are Phase 2 |
| Secrets | AES-256-GCM at rest; values returned plaintext to the UI | Fine on localhost; not fine if the panel is exposed |
| Executor trust | Loopback + bearer token; Docker socket inside the executor | Token leak is root-equivalent on the host |
| HTTPS | `auto_https off` | `*.localhost` only for now |

**Open fork (pick before expanding add-ons beyond Redis):** stay “one app + add-on toggles” (keep the facade) **or** expose services in the API/UI. Halfway is why Redis exists in the catalog but not in `ServiceType`.

## Next

Do these in order. Stabilize before product; product before platform.

### 1. Stabilize the deploy path

Failed builds must not destroy the last good release. Long builds must not stall the queue.

- [ ] On failed redeploy, leave previous containers, volumes, and Caddy config in place (`worker/deployment/processor.ts`). Never `removeVolumes` except explicit project delete (or a warned Postgres-off deploy) — see `feat/keep-last-good-release`
- [ ] Fix `GitAdapter` for URL and branch changes (`set-url` / refetch, or wipe the checkout) — `lib/adapters/git.ts`
- [ ] Unique `Service.domain` (and `port` until Caddy uses Docker DNS). Sanitize hostnames before writing Caddy snippets
- [ ] Keep deployment status as `building` until `deploy()` returns; do not rewrite `startedAt` on every status change
- [ ] Raise the ~4 minute UI poll on the project page, or switch to SSE / longer polling
- [ ] Unit-test `processDeployment` failure path and `GitAdapter` with mocks

**After the failure path is safe (still Stabilize, but unblocks concurrency):**

- [ ] Point Caddy at the app container on the project Docker network instead of `host.docker.internal:{port}`. Drop host `PortBindings` (or bind `127.0.0.1` only until then)

### 2. Product (one-app-plus-addons)

Cheap wins that match the current UI. Do not start a full multi-service control plane here unless the fork above is decided.

- [ ] Redis add-on: `ServiceType.redis` + checkbox. Recipe already lives in `lib/managed-services.ts`
- [ ] Domain PATCH must reload Caddy (today the old hostname keeps proxying until the next deploy)
- [ ] Reject empty slugs; map Prisma unique violations on slug to 409
- [ ] Write-only env vars in the UI (don’t round-trip secret values on GET)

### 3. Platform

These need a non-destructive deploy. Skip until Stabilize is ticked.

- [ ] GitHub OAuth + deploy-on-push
- [ ] Private git credentials (no tokens in the repo URL)
- [ ] Caddy automatic HTTPS (`auto_https` is off)
- [ ] Invite-only / disable open registration; require `BETTER_AUTH_SECRET` at boot
- [ ] Rollback: keep last N images, swap instead of mutate-in-place
- [ ] Build cache + dangling-image prune
- [ ] Organizations, invites, roles
- [ ] Multi-server deployments
- [ ] Dockerfile-less fallback: detect `pnpm` / `yarn`
- [ ] Per-project managed DB credentials (today every Postgres is `app:app`)

## Shipped

Keep this short. Detail lives in git history.

- [x] Nuxt control panel + REST API (CRUD projects, deploy, retry, async delete)
- [x] BullMQ worker (deploy + project deletion)
- [x] Docker executor (Dockerode, managed network, Caddy reload)
- [x] Multi-service foundation: Project namespace, `web` + optional `postgres` (`feat/multi-service-foundation`)
- [x] Better Auth email/password, per-user projects (`feat/better-auth-users`)
- [x] Executor loopback + bearer token; env encryption; CI typecheck (`feat/platform-hardening`)
- [x] Vitest unit + integration suite, split CI jobs (`#4`)
- [x] BullMQ `lockDuration` 10m + 30s lock renewal on deploy and delete workers; stalled jobs are not retried

## Parking lot

Ideas that are valid but not sequenced. Promote into Next only with a reason.

- In-UI app playground (paste Node/Go, skip git clone). Node fallback already exists; needs editor, write-to-disk, and sandboxing
- Token API for CI-triggered deploys (control plane is cookie-session only)
- Compose/systemd packaging for Nuxt + worker (today only infra runs in Compose)
- Bind platform Postgres/Redis to loopback
- `.dockerignore` for the executor image build
- Unique `(serviceId, key)` on `EnvironmentVariable`
- Health-wait the app container (today only managed services are waited)

## Known footguns (until Stabilize)

Do not “discover” these again. Delete the line when the code is fixed.

1. **Failed redeploy teardown** — `worker/deployment/processor.ts` catch still calls `down({ removeVolumes })` and removes Caddy (`feat/keep-last-good-release`).
2. **Git remote/branch not updated** on an existing `runtime/projects/{slug}/repo`.
3. **`building` is skipped** — status flips to `starting` before `deploy()`.
4. **No domain/port uniqueness** — two projects can claim `myapp.localhost` or host port 3000.
5. **UI poll gives up at ~4 minutes** — `app/pages/projects/[id].vue`.
6. **Toggling Postgres off then deploying deletes the volume** with no extra warning beyond the checkbox.
7. **Executor must be rebuilt** after executor code changes (`docker compose up -d --build docker-executor`).
