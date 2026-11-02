import { registerPlugin } from '@capacitor/core'
import { useEffect, useRef } from 'react'

/**
 * Android's back button (and back gesture). Whatever is open takes it, newest first: an open
 * dialog or sheet (closed with Escape, which they all answer), then the screens and pages that
 * registered with useBackHandler (the scanner, Review, a page that isn't Home). With nothing left,
 * the app leaves as Android's back would.
 */

type Handler = { current: () => void }
const handlers: Handler[] = []

/** While `active`, back calls `onBack` (the latest one given) before anything opened earlier. */
export function useBackHandler(active: boolean, onBack: () => void): void {
  const ref = useRef(onBack)
  useEffect(() => {
    ref.current = onBack
  })
  useEffect(() => {
    if (!active) return
    const entry: Handler = { current: () => ref.current() }
    handlers.push(entry)
    return () => {
      const i = handlers.indexOf(entry)
      if (i >= 0) handlers.splice(i, 1)
    }
  }, [active])
}

/** The open dialogs (Radix dialogs and sheets, the picker) that close on Escape. */
const OPEN_DIALOG = '[role="dialog"][data-state="open"], [role="dialog"][aria-modal="true"]'

/** Handles one press of back: true when something open took it, false when nothing is open. */
export function handleBack(): boolean {
  if (typeof document !== 'undefined' && document.querySelector(OPEN_DIALOG)) {
    const target = document.activeElement ?? document.body
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return true
  }
  const top = handlers.at(-1)
  if (!top) return false
  top.current()
  return true
}

/** The Android app's plugin (android/…/BackButtonPlugin.java): its `back` event replaces the system's back. */
interface BackButtonPlugin {
  addListener(event: 'back', cb: () => void): Promise<{ remove: () => Promise<void> }>
  /** Does what back would have done with nothing open: leaves the app. */
  exit(): Promise<void>
}

/** Takes over Android's back button. Called once, at start, in the Android app only. */
export async function listenForBack(
  plugin: BackButtonPlugin = registerPlugin<BackButtonPlugin>('BackButton')
): Promise<void> {
  await plugin.addListener('back', () => {
    if (!handleBack()) void plugin.exit()
  })
}
