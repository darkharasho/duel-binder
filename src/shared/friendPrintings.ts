import type { ScanSession } from './scanSessions'
import type { BinderDetail, BinderSummary, EntryView, FriendStats, SetChecklist } from './types'

/**
 * A friend's data comes from the server with the server's printing ids, which aren't the desktop's
 * or the phone's. Used as this catalog's, an id names some other printing (the server's id for
 * LOCR-JP001's overframe Ultra is a Final Cross printing on one desktop), so each is looked up:
 * the server id to this catalog's id, by the printing's remote_id. A printing this catalog lacks
 * gets no photo and shows the card's art.
 */
export type LocalPrintings = ReadonlyMap<number, number>

/** Looks up this catalog's id for each server printing id it has. */
export type ToLocalPrintings = (serverIds: number[]) => Promise<LocalPrintings>

const local = (ids: LocalPrintings, serverId: number | null | undefined): number | null =>
  serverId == null ? null : (ids.get(serverId) ?? null)

/** A friend's entry or wishlist item: no printing of this catalog, but its printing's photo. */
export function friendItem<T extends Pick<EntryView, 'printing' | 'printingScan'>>(
  item: T,
  ids: LocalPrintings
): T {
  return {
    ...item,
    printingScan: false,
    photoPrintingId: item.printingScan ? local(ids, item.printing.id) : null
  }
}

/** A friend's binder list: each cover's photo is of this catalog's printing. */
export const friendBinders = (bs: BinderSummary[], ids: LocalPrintings): BinderSummary[] =>
  bs.map((b) => ({ ...b, coverPrintingId: local(ids, b.coverPrintingId) }))

export const friendBinder = (b: BinderDetail, ids: LocalPrintings): BinderDetail => ({
  ...b,
  coverPrintingId: local(ids, b.coverPrintingId),
  cards: b.cards.map((c) => ({
    ...c,
    printingScan: false,
    photoPrintingId: c.printingScan && c.printing ? local(ids, c.printing.id) : null
  }))
})

/** Each rarity's photo is of this catalog's printing; its codes keep the server's ids. */
export const friendChecklist = (s: SetChecklist, ids: LocalPrintings): SetChecklist => ({
  ...s,
  cards: s.cards.map((c) => ({
    ...c,
    rarities: c.rarities.map((r) => ({ ...r, photoPrintingId: local(ids, r.defaultPrintingId) }))
  }))
})

/** A friend's session, its cards on this catalog's printings, as one's own sessions are. */
export const friendSession = (s: ScanSession, ids: LocalPrintings): ScanSession => ({
  ...s,
  cards: s.cards.map((c) => ({
    ...c,
    printingId: local(ids, c.printingId),
    photoId: local(ids, c.photoId)
  }))
})

export const friendStats = (s: FriendStats, ids: LocalPrintings): FriendStats => ({
  ...s,
  topEntries: s.topEntries.map((e) => friendItem(e, ids)),
  topSingles: s.topSingles.map((e) => friendItem(e, ids)),
  recentEntries: s.recentEntries.map((e) => friendItem(e, ids))
})

/** The server printing ids a friend's data holds, to look up in one go. */
export const serverIdsOf = {
  items: (items: Pick<EntryView, 'printing'>[]): number[] => items.map((e) => e.printing.id),
  binder: (b: BinderDetail | null): number[] =>
    b
      ? [
          ...serverIdsOf.binders([b]),
          ...b.cards.flatMap((c) => (c.printing ? [c.printing.id] : []))
        ]
      : [],
  binders: (bs: BinderSummary[]): number[] =>
    bs.flatMap((b) => (b.coverPrintingId != null ? [b.coverPrintingId] : [])),
  checklist: (s: SetChecklist | null): number[] =>
    s ? s.cards.flatMap((c) => c.rarities.map((r) => r.defaultPrintingId)) : [],
  sessions: (ss: ScanSession[]): number[] =>
    ss
      .flatMap((s) => s.cards.flatMap((c) => [c.printingId, c.photoId]))
      .filter((id): id is number => id !== null),
  stats: (s: FriendStats): number[] =>
    serverIdsOf.items([...s.topEntries, ...s.topSingles, ...s.recentEntries])
}
