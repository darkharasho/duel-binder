import { createErrorGate, describeError, scrubErrorDetails } from '@shared/errorReports'
import { usageEnabled } from './usage'

let pass = createErrorGate()
let installed = false

async function send(message: string, stack?: string): Promise<void> {
  const appVersion = await window.api.app.version()
  await window.api.errors?.report(scrubErrorDetails({ appVersion, message, stack }))
}

/** Reports an error if the usage setting is on. Reporting must never raise an error of its own. */
function capture(error: unknown, prefix = ''): void {
  try {
    if (!usageEnabled()) return
    const { message, stack } = describeError(error)
    if (!pass(prefix + message, stack)) return
    void send(prefix + message, stack).catch(() => {})
  } catch {
    // Dropped: there is nowhere safe to report this one.
  }
}

/** Watches for uncaught errors, once per page, and tells the desktop's main process the setting. */
export function installErrorReports(): void {
  if (installed) return
  installed = true
  window.addEventListener('error', (e) => capture(e.error ?? e.message))
  window.addEventListener('unhandledrejection', (e) => capture(e.reason, 'Unhandled rejection: '))
  try {
    void window.api?.errors?.setEnabled(usageEnabled()).catch(() => {})
  } catch {
    // No bridge: main stays at its default of off.
  }
}

/** Tests: forget what was sent. */
export function resetErrorReports(): void {
  pass = createErrorGate()
}
