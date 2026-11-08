import type { BinderCard, ChecklistRarity, EntryView } from '@shared/types'

/**
 * The printing whose own scan shows for an entry: its printing's, so the art comes from the
 * printing; for a friend's entry, this catalog's twin of it (photoPrintingId). The entry's imageId
 * shows when the printing has no scan.
 */
export const scanFor = (
  e: Pick<EntryView, 'printingScan' | 'printing' | 'photoPrintingId'>
): number | null => (e.printingScan ? e.printing.id : (e.photoPrintingId ?? null))

/** As scanFor, for a binder slot, which may have no printing. */
export const binderScanFor = (
  c: Pick<BinderCard, 'printingScan' | 'printing' | 'photoPrintingId'>
): number | null => (c.printingScan && c.printing ? c.printing.id : (c.photoPrintingId ?? null))

/** As scanFor, for a checklist rarity: its default printing, or a friend's checklist's twin of it. */
export const rarityScanFor = (r: ChecklistRarity | undefined): number | null | undefined =>
  r && (r.photoPrintingId !== undefined ? r.photoPrintingId : r.defaultPrintingId)
