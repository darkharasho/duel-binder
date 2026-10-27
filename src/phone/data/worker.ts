import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import { exposeStore, type MessagePortLike, type StoreFatal } from './protocol'
import { createPhoneStore } from './store'
import { openWasmDb } from './wasmSql'

/**
 * The data worker: opens the phone's database on OPFS and answers the page's store calls (see
 * protocol.ts). If the database can't be opened, it posts `{ fatal: message }` and every call fails.
 */

/** The worker's global scope, typed without the webworker lib. */
const scope = self as unknown as MessagePortLike & {
  location: Location
  removeEventListener(type: 'message', listener: (e: MessageEvent) => void): void
}

// Calls posted while the database opens are held, then handed to the store in order.
const early: MessageEvent[] = []
const hold = (e: MessageEvent): void => {
  early.push(e)
}
scope.addEventListener('message', hold)

async function main(): Promise<void> {
  try {
    const sqlite3 = await sqlite3InitModule()
    const poolUtil = await sqlite3.installOpfsSAHPoolVfs({ name: 'duel-binder' })
    const db = openWasmDb(sqlite3, { file: '/duel-binder.db', poolUtil })
    const store = createPhoneStore({
      db,
      portal: scope.location.origin,
      fetch: (...a: Parameters<typeof fetch>) => fetch(...a)
    })
    scope.removeEventListener('message', hold)
    exposeStore(store, {
      postMessage: (m, transfer) => scope.postMessage(m, transfer),
      addEventListener: (type, listener) => {
        scope.addEventListener(type, listener)
        for (const e of early.splice(0)) listener(e)
      }
    })
  } catch (e) {
    const fatal: StoreFatal = { fatal: e instanceof Error ? e.message : String(e) }
    scope.postMessage(fatal)
  }
}

void main()
