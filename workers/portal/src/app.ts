import type { SqlDb } from '../../../src/main/db/sql'

/** Vars and secrets the request handlers read. */
export interface Env {
  PUBLIC_URL: string
  DISCORD_CLIENT_ID: string
}

export interface AppDeps {
  db: SqlDb
  env: Env
  now: () => Date
  fetch: typeof fetch
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the stub router reads no deps yet
export async function handle(req: Request, _deps: AppDeps): Promise<Response> {
  const url = new URL(req.url)
  if (req.method === 'GET' && url.pathname === '/api/health') return json({ ok: true })
  return json({ error: 'Not found' }, 404)
}
