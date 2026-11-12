/**
 * The finish a Magic card is taken in when its printing comes in both: non-foil ('auto', the
 * owner's default, and 'nonfoil') or foil ('foil'), for a session of one finish. A printing with
 * one finish is always taken in it. A session setting: every session starts at 'auto'.
 */
export type FinishLock = 'auto' | 'nonfoil' | 'foil'

export const FINISH_LOCK_OPTIONS: readonly { key: FinishLock; label: string }[] = [
  { key: 'auto', label: 'Auto' },
  { key: 'nonfoil', label: 'Non-foil' },
  { key: 'foil', label: 'Foil' }
]

export const isFinishLock = (v: unknown): v is FinishLock =>
  v === 'auto' || v === 'nonfoil' || v === 'foil'
