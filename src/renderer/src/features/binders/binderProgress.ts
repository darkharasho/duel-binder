import type { BinderGoal } from '@shared/binders'
import { languageInfo } from '@shared/languages'
import type { BinderSummary } from '@shared/types'
import type { Progress } from '@/features/sets/setsView'

/** What a binder holds of its goal; `complete` needs at least one slot and none missing. */
export function binderProgress(b: Pick<BinderSummary, 'ownedSlots' | 'missingSlots'>): Progress {
  const total = b.ownedSlots + b.missingSlots
  return {
    owned: b.ownedSlots,
    total,
    percent: total > 0 ? Math.floor((b.ownedSlots / total) * 100) : 0,
    complete: total > 0 && b.missingSlots === 0
  }
}

export const GOAL_LABEL: Record<BinderGoal, string> = {
  none: 'no goal',
  card: 'one of each card',
  art: 'one of each artwork',
  printing: 'every printing'
}

/** A binder's languages for a chip or row; empty means every one. */
export function languagesLabel(languages: BinderSummary['languages']): string {
  return languages.length === 0
    ? 'all languages'
    : languages.map((l) => languageInfo(l).code.toUpperCase()).join(', ')
}
