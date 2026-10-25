import { DurableObject } from 'cloudflare:workers'
import type { SqlDb } from '../../../src/main/db/sql'
import { createPrintingArtResolver, type PrintingArtResolver } from '../../../src/main/yugipedia/artResolver'
import { createTcgplayerLookup } from '../../../src/main/tcgplayer/catalog'
import { createYugipediaClient } from '../../../src/main/yugipedia/client'
import { handle, type Env } from './app'
import { doSql } from './doSql'
import { migrateServer } from './migrate'
import { handleSite } from './site/handler'
import { routeHost } from './site/host'
import { createReleaseSource, type Downloads } from './site/releases'

export interface WorkerEnv extends Env {
  STORE: DurableObjectNamespace<Store>
  ASSETS: Fetcher
  IMAGES: R2Bucket
  GITHUB_TOKEN?: string
}

/** The single Durable Object holding the catalog and every user's collection. */
export class Store extends DurableObject<WorkerEnv> {
  private readonly db: SqlDb
  private readonly printingArt: PrintingArtResolver

  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env)
    this.db = doSql(ctx.storage)
    this.printingArt = createPrintingArtResolver({
      db: this.db,
      client: createYugipediaClient({ version: 'portal' }),
      quickUrl: createTcgplayerLookup(this.db)
    })
    void ctx.blockConcurrencyWhile(async () => migrateServer(this.db))
  }

  fetch(req: Request): Promise<Response> {
    return handle(req, {
      db: this.db,
      images: this.env.IMAGES,
      printingArt: this.printingArt,
      env: this.env,
      now: () => new Date(),
      fetch: (input, init) => fetch(input, init)
    })
  }
}

// Created on the first site request, once env (and the optional GitHub token) is known.
let downloads: (() => Promise<Downloads>) | null = null

export default {
  fetch(req, env) {
    const route = routeHost(new URL(req.url), env.SITE_URL)
    if (route.kind === 'site') {
      downloads ??= createReleaseSource({ fetch: (i, n) => fetch(i, n), now: () => new Date(), token: env.GITHUB_TOKEN })
      return handleSite(req, { appUrl: env.PUBLIC_URL, assets: env.ASSETS, downloads })
    }
    if (route.kind === 'redirect') return Response.redirect(route.location, 301)
    return env.STORE.get(env.STORE.idFromName('main')).fetch(req)
  }
} satisfies ExportedHandler<WorkerEnv>
