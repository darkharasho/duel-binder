import { ChevronDownIcon } from 'lucide-react'
import type { DeckProblem, DeckVerdict } from '@shared/decks/check'
import { cn } from '@/lib/utils'

const tone = (p: DeckProblem): string =>
  p.severity === 'error' ? 'text-destructive' : 'text-amber-400'

/**
 * The verdict's problems over the deck: the first one and a count, or all of them when expanded.
 * Clicking one shows its card. Not shown while the deck has none.
 */
export function ProblemsBar({
  verdict,
  expanded,
  onExpanded,
  onProblem
}: {
  verdict: DeckVerdict | null
  expanded: boolean
  onExpanded: (expanded: boolean) => void
  onProblem: (p: DeckProblem) => void
}): React.JSX.Element | null {
  const problems = verdict?.problems ?? []
  if (problems.length === 0) return null
  const errors = problems.filter((p) => p.severity === 'error').length
  const warnings = problems.length - errors
  const title =
    errors > 0
      ? `${errors} ${errors === 1 ? 'problem' : 'problems'}${warnings > 0 ? ` · ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}` : ''}`
      : `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`
  const row = (p: DeckProblem): React.JSX.Element => (
    <button
      type="button"
      onClick={() => onProblem(p)}
      className={cn(
        'min-w-0 truncate rounded-md px-1.5 py-0.5 text-left text-xs outline-none hover:bg-chip focus-visible:ring-2 focus-visible:ring-ring',
        tone(p)
      )}
    >
      {p.message}
    </button>
  )
  return (
    <section
      aria-label="Deck check"
      className={cn(
        'rounded-lg border px-3 py-2',
        errors > 0
          ? 'border-destructive/40 bg-destructive/10'
          : 'border-amber-400/30 bg-amber-400/[0.07]'
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'shrink-0 font-mono text-xs font-medium',
            errors > 0 ? 'text-destructive' : 'text-amber-400'
          )}
        >
          {title}
        </span>
        <div className="flex min-w-0 flex-1">{!expanded && row(problems[0])}</div>
        {problems.length > 1 && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => onExpanded(!expanded)}
            className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-xs outline-none hover:bg-chip focus-visible:ring-2 focus-visible:ring-ring"
          >
            {expanded ? 'Show less' : 'Show all'}
            <ChevronDownIcon
              className={cn('size-3.5 transition-transform', expanded && 'rotate-180')}
            />
          </button>
        )}
      </div>
      {expanded && (
        <ul aria-label="Problems" className="mt-1.5 flex max-h-48 flex-col overflow-y-auto">
          {problems.map((p) => (
            <li key={p.key} className="flex">
              {row(p)}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
