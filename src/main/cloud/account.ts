import type Database from 'better-sqlite3'
import { deleteMeta, getMeta, setMeta } from '../db/meta'
import type { Me } from '../../shared/cloud'
import type { AccountStatus } from '../../shared/types'
import { CloudAuthError, CloudOfflineError, type CloudClient } from './client'
import { syncOnce } from './engine'
import {
  accountName,
  accountState,
  activeOwner,
  adoptLocalData,
  applyPending,
  ensureAccount,
  hasLocalData,
  pendingCount,
  setActiveOwner
} from './localSync'
import { createSyncScheduler, type SyncScheduler } from './scheduler'
import type { TokenStore } from './tokenStore'

export interface ClientOptions {
  /** Per-request timeout. */
  timeoutMs?: number
  /** Aborts every request of this client (a request cut off this way fails as offline). */
  signal?: AbortSignal
}

export interface AccountDeps {
  db: Database.Database
  tokens: TokenStore
  client(token: string, opts?: ClientOptions): CloudClient
  signIn(signal: AbortSignal): Promise<{ token: string; user: Me }>
  emit(s: AccountStatus): void
  emitDataChanged(): void
  isOnline(): boolean
  now?: () => Date
}

export interface AccountService {
  status(): AccountStatus
  signIn(): Promise<AccountStatus>
  signOut(): Promise<AccountStatus>
  syncNow(): Promise<AccountStatus>
  isSignedIn(): boolean
  noteLocalEdit(): void
  catalogRefreshed(): void
  start(): void
  stop(): void
}

export const SERVER_SIGNED_OUT = 'Signed out by the server. Sign in again to keep syncing.'
/** The final push before a deliberate sign-out, and each revoke, get at most this long. */
const SIGN_OUT_CAP_MS = 10_000
const PRICE_FOLLOW_UP_MS = 20_000

type State = AccountStatus['state']

/**
 * The desktop's account: browser sign-in, background sync through a scheduler, and sign-out. Each account's
 * rows stay tagged with its owner id; signing in shows that owner's rows, signing out keeps showing them.
 */
export function createAccountService(deps: AccountDeps): AccountService {
  const { db, tokens } = deps
  const now = deps.now ?? (() => new Date())

  /** The token in memory, mirrored to the token file; null when signed out. */
  let token: string | null = tokens.get()
  let state: State = token === null ? 'signed-out' : 'idle'
  let error: string | null = null
  /** Bumped on every sign-in, sign-out and stop, so a run that outlives its session changes nothing. */
  let session = 0
  let meRefreshed = false
  let stopped = false
  let signInAbort: AbortController | null = null
  let signingIn: Promise<AccountStatus> | null = null
  let signingOut: Promise<AccountStatus> | null = null
  let runAbort: AbortController | null = null
  let inFlight: Promise<void> | null = null

  const scheduler: SyncScheduler = createSyncScheduler({
    run: () => {
      inFlight = run()
      return inFlight
    },
    isOnline: () => deps.isOnline(),
    // A run skipped for want of network shows as offline; the next successful run makes it idle again.
    onSkippedOffline: () => {
      if (token !== null && state !== 'offline') set('offline')
    }
  })

  const storedUser = (): Me | null => {
    const raw = getMeta(db, 'cloud_user')
    if (raw === null) return null
    try {
      return JSON.parse(raw) as Me
    } catch {
      return null
    }
  }

  function status(): AccountStatus {
    const owner = activeOwner(db)
    return {
      state,
      user: token === null ? null : storedUser(),
      // A name of '' is an account recorded before its name was known.
      localOwner: owner === 0 ? null : accountName(db, owner) || null,
      lastSyncedAt: owner === 0 ? null : accountState(db, owner).syncedAt,
      error,
      pendingCount: owner === 0 ? 0 : pendingCount(db, owner)
    }
  }

  function set(next: State, nextError: string | null = null): void {
    state = next
    error = nextError
    deps.emit(status())
  }

  /** Forgets the token and the signed-in user; the active owner and its rows stay. */
  function forget(): void {
    token = null
    tokens.clear()
    deleteMeta(db, 'cloud_user')
  }

  async function run(): Promise<void> {
    const current = token
    if (current === null || stopped) return
    const mine = session
    const owner = activeOwner(db)
    const abort = new AbortController()
    runAbort = abort
    set('syncing', error)
    try {
      const client = deps.client(current, { signal: abort.signal })
      const outcome = await syncOnce(db, owner, client, now)
      if (mine !== session) return
      // Before me(), so a failing me() can't swallow them.
      if (outcome.changed) deps.emitDataChanged()
      // The server prices newly pushed cards shortly; sync once more to bring them in.
      if (outcome.pushedLive > 0) scheduler.poke(PRICE_FOLLOW_UP_MS)
      if (!meRefreshed) {
        const me = await client.me()
        if (mine !== session) return
        if (me.id === owner) {
          ensureAccount(db, owner, me.displayName ?? me.username)
          setMeta(db, 'cloud_user', JSON.stringify(me))
        }
        meRefreshed = true
      }
      set('idle')
    } catch (e) {
      if (mine !== session) return
      if (e instanceof CloudAuthError) {
        // The server no longer knows this token: nothing to revoke, and no further runs.
        session++
        scheduler.stop()
        forget()
        set('signed-out', SERVER_SIGNED_OUT)
        return
      }
      if (e instanceof CloudOfflineError) set('offline')
      else set('error', e instanceof Error ? e.message : String(e))
      // Rejecting puts the scheduler on its backoff, so a failing push never retries in a tight loop.
      throw e
    } finally {
      if (runAbort === abort) runAbort = null
    }
  }

  /** Revokes a token, keeping it for a later retry only when the portal couldn't be reached. */
  async function revoke(old: string): Promise<boolean> {
    try {
      await deps.client(old, { timeoutMs: SIGN_OUT_CAP_MS }).revoke()
      return true
    } catch (e) {
      // A 401 means the token is already dead; any other answer won't change on a retry.
      return !(e instanceof CloudOfflineError)
    }
  }

  async function retryRevokes(): Promise<void> {
    if (!deps.isOnline()) return
    for (const old of tokens.pendingRevokes()) {
      if (await revoke(old)) tokens.removePendingRevoke(old)
    }
  }

  /** Makes `user` the signed-in account and shows its cards; the previous owner's rows aren't touched. */
  function becomeSignedIn(newToken: string, user: Me): void {
    const before = activeOwner(db)
    db.transaction(() => {
      ensureAccount(db, user.id, user.displayName ?? user.username)
      if (hasLocalData(db)) adoptLocalData(db, user.id)
      setActiveOwner(db, user.id)
    })()
    tokens.set(newToken)
    token = newToken
    setMeta(db, 'cloud_user', JSON.stringify(user))
    session++
    meRefreshed = false
    set('idle')
    if (before !== user.id) deps.emitDataChanged()
    scheduler.start()
  }

  async function doSignIn(): Promise<AccountStatus> {
    const abort = new AbortController()
    signInAbort = abort
    set('signing-in')
    try {
      const { token: newToken, user } = await deps.signIn(abort.signal)
      if (abort.signal.aborted || stopped) {
        // Cancelled as the browser finished: this token was never used, so don't leave it valid.
        if (!(await revoke(newToken))) tokens.addPendingRevoke(newToken)
        return status()
      }
      becomeSignedIn(newToken, user)
    } catch (e) {
      // A cancel has already set the state.
      if (!abort.signal.aborted) set('signed-out', e instanceof Error ? e.message : String(e))
    } finally {
      if (signInAbort === abort) signInAbort = null
    }
    return status()
  }

  async function doSignOut(): Promise<AccountStatus> {
    if (signInAbort) {
      signInAbort.abort()
      signInAbort = null
      if (token === null) set('signed-out')
    }
    const old = token
    if (old === null) {
      if (state !== 'signed-out') set('signed-out')
      return status()
    }

    // Ends background sync; a run still in flight is cut off and its outcome ignored.
    session++
    scheduler.stop()
    runAbort?.abort()
    // Signed out on disk before any network call: quitting during the push or revoke below can't leave
    // the token in place, and start() revokes it if this sign-out doesn't get to.
    tokens.addPendingRevoke(old)
    forget()
    await inFlight?.catch(() => {})

    // One best-effort push for this account with the token still in memory, outside the run error
    // handler: a late 401 or a timeout here can't change the status, and rows it doesn't reach stay
    // dirty for this owner.
    if (deps.isOnline()) {
      const cap = AbortSignal.timeout(SIGN_OUT_CAP_MS)
      try {
        const outcome = await syncOnce(
          db,
          activeOwner(db),
          deps.client(old, { timeoutMs: SIGN_OUT_CAP_MS, signal: cap }),
          now
        )
        if (outcome.changed) deps.emitDataChanged()
      } catch {
        // Ignored: the rows stay dirty and push when this account signs in again.
      }
    }

    if (await revoke(old)) tokens.removePendingRevoke(old)
    set('signed-out')
    return status()
  }

  function signIn(): Promise<AccountStatus> {
    // A sign-out still finishing (final push, revoke) completes first.
    if (signingOut) return signingOut.then(signIn)
    if (token !== null || stopped) return Promise.resolve(status())
    signingIn ??= doSignIn().finally(() => {
      signingIn = null
    })
    return signingIn
  }

  return {
    status,
    isSignedIn: () => token !== null,

    signIn,

    signOut() {
      signingOut ??= doSignOut().finally(() => {
        signingOut = null
      })
      return signingOut
    },

    async syncNow() {
      if (token === null) return status()
      if (!deps.isOnline()) {
        set('offline')
        return status()
      }
      await scheduler.runNow()
      return status()
    },

    noteLocalEdit() {
      if (token !== null) scheduler.poke()
    },

    catalogRefreshed() {
      if (applyPending(db).applied > 0) deps.emitDataChanged()
      if (token !== null) scheduler.poke()
    },

    start() {
      stopped = false
      void retryRevokes().catch((e) => console.error('Token revoke retry failed', e))
      if (token !== null) scheduler.start()
    },

    stop() {
      stopped = true
      session++
      scheduler.stop()
      signInAbort?.abort()
      signInAbort = null
      runAbort?.abort()
    }
  }
}
