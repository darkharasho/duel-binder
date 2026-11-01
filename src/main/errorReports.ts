import { createErrorGate, scrubErrorDetails, type ErrorDetails } from '../shared/errorReports'

/** Errors kept while main waits to hear the usage setting; a crash loop can't grow this. */
export const MAX_HELD_ERRORS = 5

export interface MainErrorReports {
  /** Records an error: sent if the setting is on, held if it's unknown, dropped if it's off. */
  capture(message: string, stack?: string): void
  /** The renderer's usage setting. Off drops anything held. */
  setEnabled(on: boolean): void
}

/**
 * The main process's error reports. The usage setting lives in the renderer's localStorage, so main
 * counts it as off until the renderer says otherwise: an early crash never goes out for a user who
 * turned it off.
 */
export function createMainErrorReports(deps: {
  version(): string
  send(details: ErrorDetails): void
}): MainErrorReports {
  const pass = createErrorGate()
  let enabled = false
  let told = false
  let held: ErrorDetails[] = []

  const send = (details: ErrorDetails): void => {
    try {
      deps.send(details)
    } catch {
      // Never let a report take the process down with it.
    }
  }

  return {
    capture(message, stack) {
      if (told && !enabled) return
      if (!told && held.length >= MAX_HELD_ERRORS) return
      if (!pass(message, stack)) return
      const details = scrubErrorDetails({ appVersion: deps.version(), message, stack })
      if (told) send(details)
      else held.push(details)
    },
    setEnabled(on) {
      told = true
      enabled = on
      const waiting = held
      held = []
      if (on) waiting.forEach(send)
    }
  }
}

/** Text for a process that went away; null for a normal exit, which isn't an error. */
export function goneMessage(
  what: string,
  details: { reason: string; exitCode: number }
): string | null {
  if (details.reason === 'clean-exit') return null
  return `${what} gone: ${details.reason} (exit ${details.exitCode})`
}
