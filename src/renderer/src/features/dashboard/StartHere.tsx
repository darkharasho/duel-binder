import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Camera, Search } from 'lucide-react'
import { englishSetName, setNameTooltip } from '@shared/setNames'
import type { LanguageFilter } from '@shared/languages'
import type { SetSummary } from '@shared/types'
import type { NavigateFn } from '@/components/AppShell'
import { Skeleton } from '@/components/ui/loading'
import { SetArt } from '@/features/sets/SetArt'
import { progressFor, readCountMode } from '@/features/sets/setsView'
import { api, queryKeys } from '@/lib/api'
import { pageInGame, useGame } from '@/lib/game'
import { matchesLanguage, useLanguageFilter } from '@/lib/languageFilter'
import { isMac, isWeb } from '@/lib/platform'

/** How many recent sets the row offers. */
const RECENT = 4
/** Smaller than this is a promo or tin, not a set someone ticks off from a stack of packs. */
const MIN_SET_SIZE = 20

/**
 * The newest released sets worth ticking off: in the language filter's language (English when it
 * shows every language), newest first, ones with art ahead of ones without.
 */
// eslint-disable-next-line react-refresh/only-export-components -- tested alongside the component
export function recentSets(
  sets: readonly SetSummary[],
  language: LanguageFilter,
  today: string
): SetSummary[] {
  const released = sets.filter(
    (s) => s.tcgDate !== null && s.tcgDate <= today && s.totalCards >= MIN_SET_SIZE
  )
  const inLanguage = released.filter((s) =>
    language === 'all' ? s.language === 'en' : matchesLanguage(language, s.language)
  )
  const pool = inLanguage.length > 0 ? inLanguage : released
  const hasArt = (s: SetSummary): number =>
    s.coverImageId !== null || s.imageKey !== null || s.packImageKey !== null ? 1 : 0
  return [...pool]
    .sort((a, b) => b.tcgDate!.localeCompare(a.tcgDate!) || hasArt(b) - hasArt(a))
    .slice(0, RECENT)
}

function RecentSet({
  s,
  onOpen
}: {
  s: SetSummary
  onOpen: (s: SetSummary) => void
}): React.JSX.Element {
  // Counted the way the set's checklist will count it, so the two agree.
  const mode = readCountMode()
  const p = progressFor(s, mode)
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(s)}
        className="group flex w-full flex-col gap-2.5 rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring"
      >
        <SetArt
          imageKey={s.imageKey}
          packImageKey={s.packImageKey}
          logoImageKey={s.logoImageKey}
          coverImageId={s.coverImageId}
          setCode={s.setCode}
          className="aspect-[4/3] w-full rounded-[4px] shadow-[0_8px_20px_rgb(0_0_0/0.45)] transition-transform duration-200 group-hover:-translate-y-1"
        />
        <div className="min-w-0 space-y-1">
          <p
            title={setNameTooltip(s.setName, s.setCode)}
            className="truncate text-sm font-semibold"
          >
            {englishSetName(s.setName, s.setCode)}
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            {p.owned} of {p.total} {mode === 'cards' ? 'cards' : 'versions'}
          </p>
        </div>
      </button>
    </li>
  )
}

interface Props {
  onNavigate: NavigateFn
  /** Opens Add card with this text in its search. */
  onSearch: (query: string) => void
  /** The line under the heading. */
  blurb: string
}

/**
 * What an empty collection shows instead of stats or a grid: a search to add the first card,
 * a way to the scanner, and the newest sets to tick off.
 */
export function StartHere({ onNavigate, onSearch, blurb }: Props): React.JSX.Element {
  const { def } = useGame()
  const [language] = useLanguageFilter()
  const [text, setText] = useState('')
  const sets = useQuery({ queryKey: queryKeys.setsList, queryFn: () => api.sets.list() })
  const today = new Date().toISOString().slice(0, 10)
  const recent = useMemo(
    () => recentSets(sets.data ?? [], language, today),
    [sets.data, language, today]
  )
  // The scanner isn't in the web app, nor in every game.
  const canScan = !isWeb() && pageInGame('scan', def)

  const search = (query: string): void => {
    onSearch(query)
    setText('')
  }

  return (
    <section aria-labelledby="start-here" className="mx-auto max-w-4xl pt-10 pb-6 max-md:pt-4">
      <div className="flex flex-col items-center text-center">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {def.name}
        </p>
        <h2 id="start-here" className="mt-2 text-3xl font-semibold tracking-tight max-md:text-2xl">
          What&apos;s in your binder?
        </h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{blurb}</p>

        <form
          role="search"
          className="mt-7 w-full max-w-xl"
          onSubmit={(e) => {
            e.preventDefault()
            search(text.trim())
          }}
        >
          <label className="flex h-14 cursor-text items-center gap-3 rounded-xl border border-white/10 bg-card px-4 shadow-[0_12px_40px_rgb(0_0_0/0.35)] transition-colors focus-within:border-white/25 hover:border-white/20">
            <Search aria-hidden className="size-5 shrink-0 text-muted-foreground" />
            <input
              value={text}
              // Typing carries on in Add card's own search, with what's typed so far.
              onChange={(e) => {
                const next = e.target.value
                if (next.trim() !== '') search(next)
                else setText(next)
              }}
              placeholder={`Search ${def.name} cards…`}
              aria-label={`Search ${def.name} cards to add`}
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
            <kbd className="shrink-0 font-mono text-xs text-muted-foreground">
              {isMac() ? '⌘K' : 'Ctrl K'}
            </kbd>
          </label>
        </form>

        {canScan && (
          <button
            type="button"
            onClick={() => onNavigate('scan')}
            className="mt-4 inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Camera aria-hidden className="size-4" />
            or scan a stack with your camera
          </button>
        )}
      </div>

      {(sets.isPending || recent.length > 0) && (
        <div className="mt-14">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h3 className="text-sm font-semibold">Or tick off a recent set</h3>
            <button
              type="button"
              onClick={() => onNavigate('sets')}
              className="rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              All sets →
            </button>
          </div>
          {sets.isPending ? (
            <div
              aria-busy
              aria-label="Loading sets"
              className="grid grid-cols-4 gap-5 max-md:grid-cols-2"
            >
              {Array.from({ length: RECENT }, (_, i) => (
                <div key={i}>
                  <Skeleton className="aspect-[4/3] w-full" />
                  <Skeleton className="mt-2.5 h-3.5 w-3/4" />
                  <Skeleton className="mt-1.5 h-3 w-1/2" />
                </div>
              ))}
            </div>
          ) : (
            <ul className="grid grid-cols-4 gap-5 max-md:grid-cols-2">
              {recent.map((s) => (
                <RecentSet
                  key={`${s.language}:${s.setName}`}
                  s={s}
                  onOpen={(set) =>
                    onNavigate('sets', { set: { setName: set.setName, language: set.language } })
                  }
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
