import type { ScanRow } from '@/features/scan/session'

/** The scanner's frosted glass: cards, chips and buttons over the blurred camera. */
export const GLASS = 'border border-white/[0.13] bg-white/[0.07] backdrop-blur-xl'

/** Rows saved before prices existed have no `price` key at all. */
export const priceOf = (row: ScanRow): number | null | undefined =>
  row.options.find((o) => o.printingId === row.printingId)?.price
