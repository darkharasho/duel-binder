import { api } from '@/lib/api'
import { isPhone, isWeb } from '@/lib/platform'
import { isNativeApp } from '@/lib/portal'

/** Saved (where, on desktop) or not, when the owner cancelled. */
export type SaveResult = { saved: true; where: string | null } | { saved: false }

const pad = (n: number): string => String(n).padStart(2, '0')

/** "rip-replay-2026-11-04.mp4", by the local date. */
export function replayFileName(ext: string, now: Date = new Date()): string {
  return `rip-replay-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.${ext}`
}

const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError'

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Puts the replay on the device: a save dialog on desktop, the share sheet in the apps, and on the
 * phone web the share sheet where the browser has one, else a download.
 */
export async function saveReplay(blob: Blob, name: string): Promise<SaveResult> {
  if (!isWeb() && !isPhone()) {
    const where = await api.app.saveReplay(name, new Uint8Array(await blob.arrayBuffer()))
    return where === null ? { saved: false } : { saved: true, where }
  }
  if (isNativeApp()) {
    // Loaded only in the apps, so Capacitor stays out of the desktop and web builds.
    const { shareFile } = await import('../../../../../phone/stream/device')
    await shareFile(name, blob.type, blob)
    return { saved: true, where: null }
  }
  const file = new File([blob], name, { type: blob.type })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return { saved: true, where: null }
    } catch (e) {
      if (isAbort(e)) return { saved: false }
      // A share needs a recent tap and the render outlasts it: the browser refuses, so download.
      if (!(e instanceof DOMException && e.name === 'NotAllowedError')) throw e
    }
  }
  download(blob, name)
  return { saved: true, where: null }
}
