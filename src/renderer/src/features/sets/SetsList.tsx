import type { CountMode, SetSummary } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { SetArt } from './SetArt'
import { SetProgress } from './SetProgress'
import { progressFor } from './setsView'

interface Props {
  sets: SetSummary[]
  mode: CountMode
  view: 'grid' | 'list'
  onOpen: (setName: string) => void
}

export function SetsList({ sets, mode, view, onOpen }: Props): React.JSX.Element {
  const grid = view === 'grid'
  return (
    <ul
      className={cn(
        grid ? 'grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4' : 'flex flex-col gap-2'
      )}
    >
      {sets.map((s) => {
        const p = progressFor(s, mode)
        const started = p.owned > 0
        return (
          <li key={s.setName}>
            <button
              type="button"
              data-started={started}
              onClick={() => onOpen(s.setName)}
              className={cn(
                'w-full rounded-xl border bg-card text-left transition-colors duration-150 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring',
                grid ? 'flex flex-col gap-3 p-3' : 'flex items-center gap-4 p-2.5',
                !started && 'opacity-60'
              )}
            >
              <SetArt
                imageKey={s.imageKey}
                setCode={s.setCode}
                className={grid ? 'h-32 w-full' : 'h-12 w-16 shrink-0'}
              />
              <div className={cn('min-w-0', grid ? 'space-y-2' : 'flex flex-1 items-center gap-4')}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.setName}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.setCode}
                    {grid && s.tcgDate ? ` · ${s.tcgDate.slice(0, 4)}` : null}
                  </div>
                  {!grid && s.tcgDate && (
                    <div className="text-xs text-muted-foreground">{s.tcgDate}</div>
                  )}
                </div>
                <div className={cn('space-y-1.5', !grid && 'w-48 shrink-0')}>
                  <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
                    <span>
                      {p.owned} / {p.total}
                    </span>
                    <span className="text-muted-foreground">{p.percent}%</span>
                  </div>
                  <SetProgress progress={p} />
                  {p.complete && (
                    <Badge className="bg-emerald-500/15 text-emerald-400">✓ Complete</Badge>
                  )}
                </div>
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
