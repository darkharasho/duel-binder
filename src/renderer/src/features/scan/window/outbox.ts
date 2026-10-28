import type { ScanDraft } from '../resolve'

/**
 * Pulls the scan window has counted but the main window hasn't acknowledged. Kept in
 * localStorage, so a pull survives the main window reloading and the scan window crashing or
 * closing; it is resent until the hub says it's on the list.
 */
export interface Outbox {
  /** Queues a pull and returns its id. */
  put(draft: ScanDraft): string
  /** Takes an acknowledged pull off. */
  ack(id: string): void
  pending(): { id: string; draft: ScanDraft }[]
}

const OUTBOX_KEY = 'scan.outbox.v1'
/** Past this, the oldest pulls go: a main window that never answers mustn't fill storage. */
const MAX_PENDING = 500

type Entry = { id: string; draft: ScanDraft }

const isEntry = (v: unknown): v is Entry => {
  if (typeof v !== 'object' || v === null) return false
  const e = v as Record<string, unknown>
  return typeof e.id === 'string' && typeof e.draft === 'object' && e.draft !== null
}

export function newDraftId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function createOutbox(storage: Storage | null = safeLocalStorage()): Outbox {
  let entries: Entry[] = load()

  function load(): Entry[] {
    try {
      const parsed: unknown = JSON.parse(storage?.getItem(OUTBOX_KEY) ?? '[]')
      return Array.isArray(parsed) ? parsed.filter(isEntry) : []
    } catch {
      return []
    }
  }

  function save(): void {
    try {
      if (entries.length === 0) storage?.removeItem(OUTBOX_KEY)
      else storage?.setItem(OUTBOX_KEY, JSON.stringify(entries))
    } catch {
      // Storage full or unavailable: pulls are still resent while this window lives.
    }
  }

  return {
    put(draft) {
      const id = newDraftId()
      entries = [...entries, { id, draft }].slice(-MAX_PENDING)
      save()
      return id
    },
    ack(id) {
      const next = entries.filter((e) => e.id !== id)
      if (next.length === entries.length) return
      entries = next
      save()
    },
    pending: () => entries
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}
