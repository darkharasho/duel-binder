import type { Language } from '@shared/languages'
import type { CountMode, SetSummary } from '@shared/types'
import { LanguageTag } from '@/components/LanguageTag'
import { formatMonthYear } from '@/lib/format'
import { cn } from '@/lib/utils'
import { SetArt } from './SetArt'
import { SetProgress } from './SetProgress'
import { progressFor } from './setsView'

interface Props {
  sets: SetSummary[]
  mode: CountMode
  view: 'grid' | 'list'
  onOpen: (setName: string, language: Language) => void
  /** The list's accessible name. */
  label?: string
  id?: string
}

export function SetsList({
  sets,
  mode,
  view,
  onOpen,
  label = 'Sets',
  id
}: Props): React.JSX.Element {
  if (view === 'grid') {
    return (
      <ul
        id={id}
        aria-label={label}
        data-view="grid"
        className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-x-5 gap-y-7"
      >
        {sets.map((s) => {
          const p = progressFor(s, mode)
          const started = p.owned > 0
          return (
            <li key={`${s.language}|${s.setName}`}>
              <button
                type="button"
                data-started={started}
                onClick={() => onOpen(s.setName, s.language)}
                className="group flex w-full flex-col gap-2.5 rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring"
              >
                <SetArt
                  imageKey={s.imageKey}
                  packImageKey={s.packImageKey}
                  logoImageKey={s.logoImageKey}
                  coverImageId={s.coverImageId}
                  setCode={s.setCode}
                  className={cn(
                    'aspect-[4/3] w-full rounded-[4px] shadow-[0_8px_20px_rgb(0_0_0/0.45)] transition-transform duration-200 group-hover:-translate-y-1',
                    !started && 'opacity-60 grayscale-[0.6]'
                  )}
                />
                <div className="min-w-0 space-y-1.5">
                  <div className="flex min-h-10 items-start gap-1.5 text-sm/5 font-semibold">
                    <span title={s.setName} className="line-clamp-2 min-w-0 break-words">
                      {s.setName}
                    </span>
                    <LanguageTag language={s.language} className="mt-px shrink-0" />
                  </div>
                  <div className="flex items-center justify-between gap-2 font-mono text-xs text-muted-foreground">
                    <span>
                      {s.setCode}
                      {s.tcgDate ? ` · ${s.tcgDate.slice(0, 4)}` : null}
                    </span>
                    <span className={cn(started && 'text-foreground')}>
                      {started ? `${p.owned} / ${p.total}` : 'Not started'}
                      {p.complete && (
                        <span aria-label="Complete" className="ml-1 text-complete">
                          ✓
                        </span>
                      )}
                    </span>
                  </div>
                  {started && <SetProgress progress={p} />}
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    )
  }
  return (
    <ul
      id={id}
      aria-label={label}
      data-view="list"
      className="divide-y divide-white/[0.06] border-b border-white/[0.06]"
    >
      {sets.map((s) => {
        const p = progressFor(s, mode)
        const started = p.owned > 0
        return (
          <li key={`${s.language}|${s.setName}`}>
            <button
              type="button"
              data-started={started}
              onClick={() => onOpen(s.setName, s.language)}
              className={cn(
                'flex w-full items-center gap-4 px-1 py-2.5 text-left max-md:gap-3 transition-colors hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:outline-ring',
                !started && 'text-muted-foreground'
              )}
            >
              <SetArt
                imageKey={s.imageKey}
                packImageKey={s.packImageKey}
                logoImageKey={s.logoImageKey}
                coverImageId={s.coverImageId}
                setCode={s.setCode}
                className={cn(
                  'size-12 shrink-0 rounded-[3px]',
                  !started && 'brightness-75 grayscale-[0.7]'
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  <span className="truncate">{s.setName}</span>
                  <LanguageTag language={s.language} />
                </div>
                <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {s.setCode}
                  {s.tcgDate && ` · ${formatMonthYear(s.tcgDate)}`}
                </div>
              </div>
              <div className="w-32 shrink-0 max-md:w-14">
                {started ? (
                  <SetProgress progress={p} className="h-[3px]" />
                ) : (
                  <span className="text-xs">Not started</span>
                )}
              </div>
              <span className="w-24 shrink-0 text-right font-mono text-[13px] max-md:w-auto max-md:text-xs">
                {started ? `${p.owned} / ${p.total}` : `— / ${p.total}`}
                {p.complete && (
                  <span aria-label="Complete" className="ml-1 text-complete">
                    ✓
                  </span>
                )}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
