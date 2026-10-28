import type { Language } from '@shared/languages'
import type { SqlDb } from '../db/sql'
import { getCardDetail, searchCards } from '../repo/cards'
import { browseCards, browseFacets } from '../repo/browse'
import { checkLanguage, checkNotesLength } from '../repo/args'
import {
  addEntry,
  entriesForCard,
  getFacets,
  listEntries,
  removeEntry,
  updateEntry
} from '../repo/collection'
import { adjustPrinting, getChecklist, listSets } from '../repo/sets'
import {
  cardsForImages,
  matchName,
  printingsByCode,
  printingsForCards,
  printingsForSet
} from '../repo/scan'
import { getStats, recordSnapshot } from '../repo/stats'
import { activeOwner, listSyncIssues } from '../cloud/localSync'

/** The channels whose handlers only need the database, so the phone runs them too. */
export const DATA_CHANNELS = [
  'cards:search',
  'cards:get',
  'cards:browse',
  'cards:browseFacets',
  'collection:list',
  'collection:forCard',
  'collection:add',
  'collection:update',
  'collection:remove',
  'collection:facets',
  'scan:printingsByCode',
  'scan:printingsForSet',
  'scan:printingsForCards',
  'scan:matchName',
  'scan:cardsForImages',
  'stats:get',
  'sets:list',
  'sets:checklist',
  'sets:adjust',
  'account:unsynced'
] as const

export type DataChannel = (typeof DATA_CHANNELS)[number]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (...args: any[]) => Promise<unknown>

/** How long, and how many, named adds are remembered to answer a repeat. */
const REPEAT_ADD_MS = 30 * 60_000
const MAX_REMEMBERED_ADDS = 500

export function createDataHandlers({
  db,
  onEdit
}: {
  db: SqlDb
  onEdit(): void
}): Record<DataChannel, Handler> {
  // Keep today's value snapshot meaning "end of day" as the collection changes.
  const snapshotAfter = <T>(result: T): T => {
    recordSnapshot(db)
    return result
  }
  // A write to the collection: the account syncs it shortly.
  const edited = <T>(result: T): T => {
    onEdit()
    return result
  }
  // Named adds already done, with what they returned, oldest first.
  const doneAdds = new Map<string, { at: number; result: unknown }>()
  const rememberAdd = (id: string, result: unknown): void => {
    const now = Date.now()
    for (const [key, { at }] of doneAdds) {
      if (doneAdds.size < MAX_REMEMBERED_ADDS && now - at < REPEAT_ADD_MS) break
      doneAdds.delete(key)
    }
    doneAdds.set(id, { at: now, result })
  }
  return {
    'cards:search': async (q: string) => searchCards(db, q),
    'cards:get': async (cardId: number) => getCardDetail(db, cardId),
    'cards:browse': async (f) => browseCards(db, f),
    'cards:browseFacets': async () => browseFacets(db),
    'collection:list': async (f) => listEntries(db, f),
    'collection:forCard': async (cardId: number) => entriesForCard(db, cardId),
    'collection:add': async (input) => {
      checkNotesLength(input)
      const id: unknown = input?.requestId
      if (typeof id !== 'string') return edited(snapshotAfter(addEntry(db, input)))
      const done = doneAdds.get(id)
      if (done && Date.now() - done.at < REPEAT_ADD_MS) return done.result
      const result = edited(snapshotAfter(addEntry(db, input)))
      rememberAdd(id, result)
      return result
    },
    'collection:update': async (id: number, patch) => {
      checkNotesLength(patch)
      return edited(snapshotAfter(updateEntry(db, id, patch)))
    },
    'collection:remove': async (id: number) => edited(snapshotAfter(removeEntry(db, id))),
    'collection:facets': async () => getFacets(db),
    'scan:printingsByCode': async (code: string) => printingsByCode(db, code),
    'scan:printingsForSet': async (setName: string, language: Language) =>
      printingsForSet(db, setName, checkLanguage(language)),
    'scan:printingsForCards': async (cardIds: number[]) => printingsForCards(db, cardIds),
    'scan:matchName': async (text: string) => matchName(db, text),
    'scan:cardsForImages': async (imageIds: unknown) => {
      if (!Array.isArray(imageIds) || !imageIds.every((i) => Number.isInteger(i)))
        throw new Error('Image ids must be a list of integers')
      return cardsForImages(db, imageIds)
    },
    'stats:get': async () => getStats(db),
    'sets:list': async () => listSets(db),
    'sets:checklist': async (setName: string, language: Language) =>
      getChecklist(db, setName, checkLanguage(language)),
    'sets:adjust': async (setName: string, language: Language, printingId: number, delta: 1 | -1) =>
      edited(
        snapshotAfter(adjustPrinting(db, setName, checkLanguage(language), printingId, delta))
      ),
    'account:unsynced': async () => listSyncIssues(db, activeOwner(db))
  }
}
