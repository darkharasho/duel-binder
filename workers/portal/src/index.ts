import { DurableObject } from 'cloudflare:workers'
import type { SqlDb } from '../../../src/main/db/sql'
import { handle, type Env } from './app'
import { doSql } from './doSql'
import { migrateServer } from './migrate'

export interface WorkerEnv extends Env {
  STORE: DurableObjectNamespace<Store>
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

export default {
  fetch(req, env) {
    return env.STORE.get(env.STORE.idFromName('main')).fetch(req)
  }
} satisfies ExportedHandler<WorkerEnv>
