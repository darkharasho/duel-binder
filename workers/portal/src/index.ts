import { DurableObject } from 'cloudflare:workers'
import type { SqlDb } from '../../../src/main/db/sql'
import {
  createPrintingArtResolver,
  type PrintingArtResolver
} from '../../../src/main/yugipedia/artResolver'
import { createTcgplayerLookup } from '../../../src/main/tcgplayer/catalog'
import { createYugipediaClient } from '../../../src/main/yugipedia/client'
import { handle, type Env } from './app'
import { createImageQuota } from './images'
import { doSql } from './doSql'
import { migrateServer } from './migrate'
import { alarmQueue, priceClientFor, runPriceAlarm, type PriceQueue } from './prices'
import { sweepClientFor } from './sweep'
import { handleSite } from './site/handler'
import { routeHost } from './site/host'
import { createReleaseSource, type Downloads } from './site/releases'

export interface WorkerEnv extends Env {
  STORE: DurableObjectNamespace<Store>
  ASSETS: Fetcher
  IMAGES: R2Bucket
  GITHUB_TOKEN?: string
  /** Service binding to the eBay price Worker; see priceClientFor. */
  PRICES?: Fetcher
}

/** The single Durable Object holding the catalog and every user's collection. */
export class Store extends DurableObject<WorkerEnv> {
  private readonly db: SqlDb
  private readonly printingArt: PrintingArtResolver
  private readonly prices: PriceQueue
  private readonly imageQuota = createImageQuota(Date.now)

  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env)
    this.db = doSql(ctx.storage)
    this.printingArt = createPrintingArtResolver({
      db: this.db,
      client: createYugipediaClient({ version: 'portal' }),
      quickUrl: createTcgplayerLookup(this.db)
    })
    this.prices = alarmQueue(ctx.storage, Date.now)
    void ctx.blockConcurrencyWhile(async () => {
      migrateServer(this.db)
      // First start (or a lost alarm): begin pricing what is already owned.
      if ((await ctx.storage.getAlarm()) === null) await this.prices.soon()
    })
  }

  /** Keeps eBay prices fresh for every printing any user owns; re-arms itself. */
  async alarm(): Promise<void> {
    await runPriceAlarm(this.db, priceClientFor(this.env), this.ctx.storage, () => new Date(), sweepClientFor(this.env))
  }

  fetch(req: Request): Promise<Response> {
    return handle(req, {
      db: this.db,
      assets: this.env.ASSETS,
      images: this.env.IMAGES,
      imageQuota: this.imageQuota,
      printingArt: this.printingArt,
      prices: this.prices,
      env: this.env,
      storageBytes: () => this.ctx.storage.sql.databaseSize,
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
      downloads ??= createReleaseSource({
        fetch: (i, n) => fetch(i, n),
        now: () => new Date(),
        token: env.GITHUB_TOKEN
      })
      return handleSite(req, { appUrl: env.PUBLIC_URL, assets: env.ASSETS, downloads })
    }
    if (route.kind === 'redirect') return Response.redirect(route.location, 301)
    if (route.kind === 'app-asset') return env.ASSETS.fetch(req)
    if (route.kind === 'scan-asset')
      return env.ASSETS.fetch(new Request(new URL(route.asset, req.url), req))
    return env.STORE.get(env.STORE.idFromName('main')).fetch(req)
  }
} satisfies ExportedHandler<WorkerEnv>
