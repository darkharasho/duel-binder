import { useQuery } from '@tanstack/react-query'
import { api, queryKeys } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * Says which community terms in the search text matched and what each stands for, one muted line
 * each: “bubble mew” — Mew ex · Paldean Fates 232/91. `q` is the page's already-debounced search.
 */
export function TermNotes({
  q,
  className
}: {
  q: string
  className?: string
}): React.JSX.Element | null {
  const text = q.trim()
  const notes = useQuery({
    queryKey: queryKeys.termNotes(text),
    queryFn: () => api.cards.explain(text),
    enabled: text !== ''
  })
  if (text === '' || !notes.data || notes.data.length === 0) return null
  return (
    <div className={cn('mb-2 flex flex-col gap-0.5', className)}>
      {notes.data.map((n) => (
        <p key={n.phrase} className="text-sm text-muted-foreground">
          “{n.phrase}” — {n.label}
        </p>
      ))}
    </div>
  )
}
