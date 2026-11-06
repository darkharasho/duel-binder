import type { EntryView } from '@shared/types'

/** Total for display: null (shown as "—") when the entry has no price at all. */
export const displayTotal = (e: EntryView): number | null =>
  e.unitPrice === null ? null : e.totalValue
