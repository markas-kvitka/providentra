import { caddyAdminUrl } from './config'

export interface CaddyReloadResult {
  messages: string[]
}

/**
 * Relays a Caddyfile to Caddy's admin API `/load` endpoint over the internal
 * Docker network. The executor is the only component on that network with a
 * published API, so the admin port (2019) never needs to be exposed to the host.
 */
export async function reloadCaddy(caddyfile: string): Promise<CaddyReloadResult> {
  let response: Response
  try {
    response = await fetch(`${caddyAdminUrl}/load`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/caddyfile',
        // Caddy's admin API enforces an origin allowlist when bound to a
        // non-loopback address; this must match one of the configured origins.
        Origin: caddyAdminUrl,
      },
      body: caddyfile,
    })
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Could not reach Caddy admin API at ${caddyAdminUrl} (${cause}). `
      + 'Ensure the caddy service is running on the same Docker network.',
    )
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).trim()
    throw new Error(`Caddy admin reload failed (${response.status})${detail ? `: ${detail}` : ''}`)
  }

  return { messages: [`Reloaded Caddy config via ${caddyAdminUrl}`] }
}
