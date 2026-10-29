import { useId } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Language } from '@shared/languages'
import type { CountMode, SetSummary } from '@shared/types'
import { formatMonthDay } from '@/lib/format'
import { cn } from '@/lib/utils'
import { SetsList } from './SetsList'

interface Props {
  sets: SetSummary[]
  /** The last release date still in the main list ('YYYY-MM-DD'). */
  cutoff: string
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: CountMode
  view: 'grid' | 'list'
  onOpen: (setName: string, language: Language) => void
}

/** A quiet, expandable line for sets releasing after the cutoff; nothing when there are none. */
export function UpcomingSets({
  sets,
  cutoff,
  open,
  onOpenChange,
  mode,
  view,
  onOpen
}: Props): React.JSX.Element | null {
  const listId = useId()
  if (sets.length === 0) return null
  const noun = sets.length === 1 ? 'upcoming set' : 'upcoming sets'
  return (
    <section className="rounded-md border border-white/[0.06]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-white/[0.03] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="tabular-nums">
          {sets.length} {noun} · releasing after {formatMonthDay(cutoff)}
        </span>
        <ChevronDown
          aria-hidden
          className={cn('ml-auto size-3.5 transition-transform', open && 'rotate-180')}
        />
      </button>
      <div id={listId} hidden={!open} className={cn(view === 'grid' ? 'p-3' : 'px-2')}>
        {open && (
          <SetsList sets={sets} mode={mode} view={view} onOpen={onOpen} label="Upcoming sets" />
        )}
      </div>
    </section>
  )
}
