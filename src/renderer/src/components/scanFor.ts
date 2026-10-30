import type { EntryView } from '@shared/types'

/**
 * The printing whose own scan shows for an entry: its printing's, so the art comes from the
 * printing. The entry's imageId shows when the printing has no scan.
 */
export const scanFor = (e: Pick<EntryView, 'printingScan' | 'printing'>): number | null =>
  e.printingScan ? e.printing.id : null
