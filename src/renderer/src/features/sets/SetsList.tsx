import { memo, useMemo } from 'react'
import type { Language } from '@shared/languages'
import { englishSetName, setNameTooltip } from '@shared/setNames'
import type { CountMode, SetSummary } from '@shared/types'
import { LanguageTag } from '@/components/LanguageTag'
import { formatMonthYear } from '@/lib/format'
import { useChunkedList } from '@/lib/useChunkedList'
import { isPhone } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { SetArt } from './SetArt'
import { SetProgress } from './SetProgress'
import { progressFor, seriesGroups } from './setsView'

interface Props {
  sets: SetSummary[]
  mode: CountMode
  view: 'grid' | 'list'
  onOpen: (setName: string, language: Language) => void
  /** The list's accessible name. */
  label?: string
  id?: string
  /** Groups the sets under a header per series (see seriesGroups). */
  bySeries?: boolean
}

/** What a series header says for sets with none. */
export const OTHER_SERIES = 'Other'

interface ItemProps {
  s: SetSummary
  mode: CountMode
  onOpen: (setName: string, language: Language) => void
}

function GridItem({ s, mode, onOpen }: ItemProps): React.JSX.Element {
  const p = progressFor(s, mode)
  const started = p.owned > 0
  return (
    <li className="lazy-item [--lazy-h:290px]">
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
            <span
              title={setNameTooltip(s.setName, s.setCode)}
              className="line-clamp-2 min-w-0 break-words"
            >
              {englishSetName(s.setName, s.setCode)}
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
}

function ListItem({ s, mode, onOpen }: ItemProps): React.JSX.Element {
  const p = progressFor(s, mode)
  const started = p.owned > 0
  return (
    <li className="lazy-item [--lazy-h:69px]">
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
            <span title={setNameTooltip(s.setName, s.setCode)} className="truncate">
              {englishSetName(s.setName, s.setCode)}
            </span>
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
}

const LIST_CLASS = {
  grid: 'grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-x-5 gap-y-7',
  list: 'divide-y divide-white/[0.06] border-b border-white/[0.06]'
}

/** Memoized: the page re-renders on every keystroke and open set, and a list can be a thousand rows. */
export const SetsList = memo(function SetsList({
  sets,
  mode,
  view,
  onOpen,
  label = 'Sets',
  id,
  bySeries = false
}: Props): React.JSX.Element {
  const groups = useMemo(() => (bySeries ? seriesGroups(sets) : null), [bySeries, sets])
  const ordered = useMemo(() => (groups ? groups.flatMap((g) => g.sets) : sets), [groups, sets])
  const [shown, endRef] = useChunkedList(ordered)
  const Item = view === 'grid' ? GridItem : ListItem
  const items = (list: readonly SetSummary[]): React.JSX.Element[] =>
    list.map((s) => <Item key={`${s.language}|${s.setName}`} s={s} mode={mode} onOpen={onOpen} />)
  if (!groups) {
    return (
      <ul ref={endRef} id={id} aria-label={label} data-view={view} className={LIST_CLASS[view]}>
        {items(shown)}
      </ul>
    )
  }
  // Each series is a section of the one list the chunking fills in, so its header shows with its
  // first set. On the desktop the header sticks under the page's own while its sets scroll by; the
  // phone's page header scrolls away, and so do these.
  const phone = isPhone()
  const sections = groups.map((g, i) => {
    const start = groups.slice(0, i).reduce((n, x) => n + x.sets.length, 0)
    return { g, run: shown.slice(start, start + g.sets.length) }
  })
  return (
    <div
      ref={endRef}
      id={id}
      role="group"
      aria-label={label}
      data-view={view}
      className="space-y-6"
    >
      {sections.map(({ g, run }) => {
        if (run.length === 0) return null
        const name = g.series ?? OTHER_SERIES
        return (
          <section key={name} aria-label={name}>
            <h2
              className={cn(
                'z-10 -mx-8 flex items-baseline gap-2 border-b border-white/[0.06] px-8 py-2 max-md:-mx-4 max-md:px-4',
                !phone && 'sticky top-[var(--page-header-h,0px)] bg-background/60 backdrop-blur-xl',
                view === 'grid' && 'mb-4'
              )}
            >
              <span className="text-sm font-semibold tracking-tight">{name}</span>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {g.sets.length} {g.sets.length === 1 ? 'set' : 'sets'}
              </span>
            </h2>
            <ul aria-label={name} className={LIST_CLASS[view]}>
              {items(run)}
            </ul>
          </section>
        )
      })}
    </div>
  )
})
