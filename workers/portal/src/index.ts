import { DurableObject } from 'cloudflare:workers'
import type { SqlDb } from '../../../src/main/db/sql'
import { handle, type Env } from './app'
import { doSql } from './doSql'
import { migrateServer } from './migrate'
import { handleSite } from './site/handler'
import { routeHost } from './site/host'
import { createReleaseSource } from './site/releases'

export interface WorkerEnv extends Env {
  STORE: DurableObjectNamespace<Store>
  SITE_URL: string
  ASSETS: Fetcher
}

/** The single Durable Object holding the catalog and every user's collection. */
export class Store extends DurableObject<WorkerEnv> {
  private readonly db: SqlDb

  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env)
    this.db = doSql(ctx.storage)
    void ctx.blockConcurrencyWhile(async () => migrateServer(this.db))
  }

  fetch(req: Request): Promise<Response> {
    return handle(req, {
      db: this.db,
      env: this.env,
      now: () => new Date(),
      fetch: (input, init) => fetch(input, init)
    })
  }
}

const downloads = createReleaseSource({ fetch: (i, n) => fetch(i, n), now: () => new Date() })

export default {
  fetch(req, env) {
    const route = routeHost(new URL(req.url), env.SITE_URL)
    if (route.kind === 'site') {
      return handleSite(req, { appUrl: env.PUBLIC_URL, assets: env.ASSETS, downloads })
    }
    if (route.kind === 'redirect') return Response.redirect(route.location, 301)
    return env.STORE.get(env.STORE.idFromName('main')).fetch(req)
  }
} satisfies ExportedHandler<WorkerEnv>
