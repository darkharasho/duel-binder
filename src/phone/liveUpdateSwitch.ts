import { useEffect } from 'react'
import type { Page } from '@/components/AppShell'
import { api } from '@/lib/api'
import { SHOWN_KEY, startLiveUpdate, type LiveUpdate } from './liveUpdate'

export interface HomeIdleDeps {
  live: LiveUpdate | null
  syncing: () => Promise<boolean>
  idleMs?: number
}

const IDLE_MS = 2000
const FADE_MS = 150
const FADE_CLASS = 'live-update-fade'
/** Fired by liveUpdate when a download finishes, so a Home visit already under way can arm. */
export const LIVE_PENDING_EVENT = 'duelbinder:live-pending'
const INPUTS = ['pointerdown', 'keydown', 'touchstart'] as const

const defaultDeps = (): HomeIdleDeps => ({
  live: startLiveUpdate(),
  syncing: async () => (await api.account.status()).state === 'syncing'
})

/**
 * Switch to a downloaded bundle once the user has sat idle on Home for 2 s with no dialog open and
 * no sync running. The screen fades first so the reload is not a flash.
 */
export function useHomeIdleSwitch(page: Page, deps?: HomeIdleDeps): void {
  const live = deps ? deps.live : undefined
  const syncingFn = deps?.syncing
  const idleMs = deps?.idleMs ?? IDLE_MS

  useEffect(() => {
    if (page !== 'dashboard') return
    const d = deps ?? defaultDeps()
    const lu = d.live
    if (!lu) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let fadeTimer: ReturnType<typeof setTimeout> | undefined
    let epoch = 0
    let applying = false
    let called = false
    let gone = false
    // Nothing arms until liveUpdate has checked its pending entry against the plugin: before that
    // it may name the bundle that is already running, or one the plugin rolled back.
    let reconciled = false

    // Input during the fade is ignored: the switch is already under way.
    const arm = (): void => {
      if (applying || gone || !reconciled) return
      epoch++
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      if (!lu.pending()) return
      timer = setTimeout(() => void fire(), idleMs)
    }
    const fire = async (): Promise<void> => {
      timer = undefined
      if (document.querySelector('[role="dialog"]') !== null) return arm()
      const mine = epoch
      let busy = false
      try {
        busy = await d.syncing()
      } catch {
        busy = false
      }
      // Input (or a pending-event) arrived during the check: that re-armed a fresh wait.
      if (gone || epoch !== mine) return
      if (busy) return arm()
      // A check may have unstaged it (withdrawn) during the wait: then there is nothing to fade to.
      if (!lu.pending()) return
      applying = true
      document.documentElement.classList.add(FADE_CLASS)
      fadeTimer = setTimeout(() => {
        fadeTimer = undefined
        called = true
        void lu.applyNow().catch(() => {
          applying = false
          called = false
          document.documentElement.classList.remove(FADE_CLASS)
          arm()
        })
      }, FADE_MS)
    }

    for (const e of INPUTS) document.addEventListener(e, arm, true)
    window.addEventListener(LIVE_PENDING_EVENT, arm)
    void lu.ready().then(() => {
      reconciled = true
      arm()
    })
    return () => {
      gone = true
      if (timer !== undefined) clearTimeout(timer)
      if (fadeTimer !== undefined) clearTimeout(fadeTimer)
      for (const e of INPUTS) document.removeEventListener(e, arm, true)
      window.removeEventListener(LIVE_PENDING_EVENT, arm)
      if (!called) document.documentElement.classList.remove(FADE_CLASS)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, live, syncingFn, idleMs])
}

/**
 * The note for a version the user hasn't been told about: null on the first run and when the
 * version is unchanged. Always records the current version.
 */
export function updatedNote(storage: Storage, current: string): string | null {
  const shown = storage.getItem(SHOWN_KEY)
  storage.setItem(SHOWN_KEY, current)
  return shown !== null && shown !== current ? `Updated to ${current}` : null
}
