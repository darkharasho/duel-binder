import { useEffect, useState } from 'react'
import { printingImageSrc, printingPhotoSrc } from '@/lib/images'
import { isPhone } from '@/lib/platform'

/**
 * The phone's printing photos. Its printing ids are its own, and a photo is named by the server's
 * id, so each printing on screen is looked up once (batched, in the phone's local database) and
 * remembered: the server id, or null for a printing the server doesn't know.
 */
const serverIds = new Map<number, number | null>()
const queued = new Set<number>()
const asked = new Set<number>()
const listeners = new Set<() => void>()
let flushing: Promise<void> | null = null

function flush(): void {
  const ids = [...queued]
  queued.clear()
  flushing = null
  if (ids.length === 0) return
  for (const id of ids) asked.add(id)
  const lookup = window.api?.images.photoIds
  if (!lookup) return
  lookup(ids)
    .then((pairs) => {
      const found = new Map(pairs)
      for (const id of ids) serverIds.set(id, found.get(id) ?? null)
    })
    // Offline or failing: the default art stays; a later mount asks again.
    .catch(() => {})
    .finally(() => {
      for (const id of ids) asked.delete(id)
      for (const l of [...listeners]) l()
    })
}

function request(printingId: number): void {
  if (serverIds.has(printingId) || asked.has(printingId)) return
  queued.add(printingId)
  // One lookup for every art rendered in the same tick.
  flushing ??= Promise.resolve().then(flush)
}

/**
 * The phone's photo URLs for these printings, in one batched lookup (remembered, as the tiles'
 * own lookups are); a printing the server doesn't know, or a failed lookup, has none.
 */
export async function phonePrintingPhotoSrcs(
  printingIds: readonly number[]
): Promise<Map<number, string>> {
  const unknown = printingIds.filter((id) => !serverIds.has(id))
  const lookup = window.api?.images.photoIds
  if (unknown.length > 0 && lookup) {
    try {
      const found = new Map(await lookup(unknown))
      for (const id of unknown) serverIds.set(id, found.get(id) ?? null)
      for (const l of [...listeners]) l()
    } catch {
      // Offline: no photos fetched ahead; the tiles ask for themselves.
    }
  }
  const out = new Map<number, string>()
  for (const id of printingIds) {
    const server = serverIds.get(id)
    if (server != null) out.set(id, printingPhotoSrc(server))
  }
  return out
}

/** Forgets every lookup, for tests. (A phone's catalog reset runs as its store opens, before any art.) */
export function resetPrintingPhotos(): void {
  serverIds.clear()
  queued.clear()
  asked.clear()
}

/**
 * The URL of a printing's own photo, or null for none: on desktop and the web at once; on the
 * phone once its server id is known (null meanwhile, so the default art shows).
 */
export function usePrintingPhotoSrc(printingId: number | null): string | null {
  const phone = isPhone()
  const [, rerender] = useState(0)
  useEffect(() => {
    if (!phone || printingId == null) return
    const l = (): void => rerender((n) => n + 1)
    listeners.add(l)
    request(printingId)
    return () => {
      listeners.delete(l)
    }
  }, [phone, printingId])
  if (printingId == null) return null
  if (!phone) return printingImageSrc(printingId)
  const id = serverIds.get(printingId)
  return id == null ? null : printingPhotoSrc(id)
}
