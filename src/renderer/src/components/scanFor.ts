import type { EntryView } from '@shared/types'

/** The printing whose own photo shows for an entry: only when it keeps the original artwork. */
export const scanFor = (e: Pick<EntryView, 'originalArt' | 'printing'>): number | null =>
  e.originalArt ? e.printing.id : null
