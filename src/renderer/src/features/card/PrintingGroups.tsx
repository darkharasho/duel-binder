import { useState } from 'react'
import { Heart } from 'lucide-react'
import type { GameId } from '@shared/games'
import { languageInfo, type Language } from '@shared/languages'
import { englishSetName } from '@shared/setNames'
import type { Printing } from '@shared/types'
import { CardArt } from '@/components/CardArt'
import { LanguageTag } from '@/components/LanguageTag'
import { SearchInput } from '@/components/SearchInput'
import { Button } from '@/components/ui/button'
import { WishToggle } from '@/features/wishlist/WishToggle'
import { formatUsd } from '@/lib/format'
import { rarityColor } from '@/lib/rarityColors'
import { cn } from '@/lib/utils'
import type { CardTypeRow } from './cardTypes'
import {
  artGroups,
  defaultLanguageMode,
  englishModeLanguages,
  setRows,
  type LanguageMode
} from './printingGroups'

interface PrintingGroupsProps {
  game: GameId
  cardId: number
  cardName: string
  /** Every row of the card, owned ones included: a printing's pill counts all of its rows. */
  rows: CardTypeRow[]
  /** The card's original art, for a tile whose printing has no art of its own. */
  originalImageId?: number
  selectedKey?: string
  onSelect: (row: CardTypeRow) => void
  ownedOf: (row: CardTypeRow) => number
  /** The row's −/count/+, and its last-copy confirm. */
  stepper: (row: CardTypeRow, label: string) => React.ReactNode
  /** Whether the printing is on the user's wishlist. */
  wished: (printingId: number) => boolean
  /** The set the panel was opened from: its row comes first, and its language is let through. */
  preferSet?: { setName: string; language: Language }
  /** Shows a box to narrow the printings by set, code or rarity. */
  searchable: boolean
}

/** Whether a printing's set name, set code or rarity holds every word of the text, ignoring case. */
const printingMatches = (p: Printing, text: string): boolean => {
  const hay =
    `${p.setName} ${englishSetName(p.setName, p.setCode)} ${p.setCode} ${p.setRarity}`.toLowerCase()
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w))
}

/** A printing's accessible name, as its owned line and its row before it were named. */
const nameOf = (cardName: string, p: Printing): string => `${cardName} ${p.setCode} ${p.setRarity}`

/** A small two-way switch: pressed is the one on. */
function Toggle({
  pressed,
  onClick,
  children
}: {
  pressed: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Button
      variant={pressed ? 'secondary' : 'ghost'}
      size="sm"
      aria-pressed={pressed}
      className="h-6 px-2 text-xs"
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

/**
 * Every printing of a card, grouped: art tiles when it has more than one art, then a row per set
 * (and language) with a pill per printing. A pill shows its rarity and price, or the count owned
 * in gold. Picking a pill selects its printing and opens an action row under its set: the wish
 * heart, and the −/count/+ when the printing has a single original-art row. A copy on other art,
 * or one of several entries, is edited in Your copies only, so the count logic stays one.
 */
export function PrintingGroups({
  game,
  cardId,
  cardName,
  rows,
  originalImageId,
  selectedKey,
  onSelect,
  ownedOf,
  stepper,
  wished,
  preferSet,
  searchable
}: PrintingGroupsProps): React.JSX.Element {
  const rowsOf = new Map<number, CardTypeRow[]>()
  for (const r of rows) {
    const same = rowsOf.get(r.printing.id)
    if (same) same.push(r)
    else rowsOf.set(r.printing.id, [r])
  }
  const printings = [...rowsOf.values()].map((rs) => rs[0].printing)
  const ownedCount = (p: Printing): number =>
    (rowsOf.get(p.id) ?? []).reduce((n, r) => n + ownedOf(r), 0)

  const [query, setQuery] = useState('')
  const [art, setArt] = useState<string | null>(null)
  const [mode, setMode] = useState<LanguageMode>(() => defaultLanguageMode(printings))
  const oneLanguage = new Set(printings.map((p) => p.language)).size <= 1
  const selectedPrinting = rows.find((r) => r.key === selectedKey)?.printing

  // English lets through the languages the user owns or opened, and the one picked, so a row
  // being worked on never drops out from under the cursor.
  const english = englishModeLanguages(
    printings.filter((p) => (rowsOf.get(p.id) ?? []).some((r) => r.entry || ownedOf(r) > 0)),
    preferSet
  )
  if (selectedPrinting) english.add(selectedPrinting.language)
  const searched =
    searchable && query.trim() ? printings.filter((p) => printingMatches(p, query)) : printings
  const inLanguage =
    mode === 'all' || oneLanguage ? searched : searched.filter((p) => english.has(p.language))
  const groups = artGroups(inLanguage, game)
  const artOn = groups.length > 1 && groups.some((g) => g.kind.key === art) ? art : null
  const shown = artOn ? (groups.find((g) => g.kind.key === artOn)?.printings ?? []) : inLanguage
  const sets = setRows(shown, game, preferSet)

  return (
    <div className="space-y-2">
      {groups.length > 1 && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {groups.map((g) => {
            const on = g.kind.key === artOn
            const n = g.printings.length
            const imageId = g.thumb.artImageId ?? originalImageId
            return (
              <button
                key={g.kind.key}
                type="button"
                aria-pressed={on}
                aria-label={`${g.kind.label}, ${n} ${n === 1 ? 'printing' : 'printings'}`}
                onClick={() => setArt(on ? null : g.kind.key)}
                className={cn(
                  'flex w-14 shrink-0 flex-col items-center gap-0.5 rounded-md p-0.5 outline-none transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-ring/60',
                  on ? 'bg-white/[0.07] ring-1 ring-primary' : 'hover:bg-white/[0.04]'
                )}
              >
                {imageId !== undefined ? (
                  <CardArt
                    imageId={imageId}
                    printingId={g.thumb.id}
                    size="small"
                    alt=""
                    className="w-full rounded-[3px]"
                  />
                ) : (
                  <span aria-hidden className="aspect-[59/86] w-full rounded-[3px] bg-muted" />
                )}
                <span className="w-full truncate text-center text-[10px] leading-tight">
                  {g.kind.label}
                </span>
                <span className="text-[10px] leading-none text-muted-foreground tabular-nums">
                  {n}
                </span>
              </button>
            )
          })}
        </div>
      )}
      {!oneLanguage && (
        <div className="flex gap-1">
          <Toggle pressed={mode === 'english'} onClick={() => setMode('english')}>
            English
          </Toggle>
          <Toggle pressed={mode === 'all'} onClick={() => setMode('all')}>
            All languages
          </Toggle>
        </div>
      )}
      {searchable && (
        <SearchInput
          label="Search printings"
          placeholder="Search by set, code or rarity"
          value={query}
          onChange={setQuery}
          debounceMs={0}
        />
      )}
      {printings.length > 0 && sets.length === 0 && (
        <p className="text-xs text-muted-foreground">No prints match</p>
      )}
      <ul aria-label="Sets" className="space-y-1.5">
        {sets.map((set) => {
          const setName = englishSetName(set.setName, set.pills[0]?.printing.setCode ?? '')
          const picked = set.pills.find((pill) => selectedKey === `p${pill.printing.id}`)
          return (
            <li
              key={set.key}
              aria-label={[
                set.codePrefix,
                setName,
                set.language !== 'en' && languageInfo(set.language).label
              ]
                .filter(Boolean)
                .join(' ')}
              className="text-xs"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="shrink-0 font-mono text-[11px]">{set.codePrefix}</span>
                <span className="min-w-0 truncate text-muted-foreground">{setName}</span>
                {mode === 'all' && <LanguageTag language={set.language} />}
                {set.year && (
                  <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
                    {set.year}
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {set.pills.map(({ printing: p, label }) => {
                  const on = picked?.printing.id === p.id
                  const owned = ownedCount(p)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={on}
                      aria-label={nameOf(cardName, p)}
                      onClick={() => {
                        const row = rowsOf.get(p.id)?.find((r) => r.key === `p${p.id}`)
                        if (row) onSelect(row)
                      }}
                      className={cn(
                        'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] outline-none transition-colors',
                        'focus-visible:ring-2 focus-visible:ring-ring/60',
                        owned > 0 ? 'border-amber-400/50' : 'border-border',
                        on ? 'bg-white/[0.1] ring-1 ring-primary' : 'hover:bg-white/[0.05]'
                      )}
                    >
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: rarityColor(p.setRarity, game) }}
                      />
                      <span className="truncate">{label}</span>
                      {wished(p.id) && (
                        <Heart
                          role="img"
                          aria-label="On your wishlist"
                          className="size-2.5 shrink-0 fill-rose-400 text-rose-400"
                        />
                      )}
                      {owned > 0 ? (
                        <span className="font-semibold text-amber-300 tabular-nums">×{owned}</span>
                      ) : (
                        p.setPrice !== null && (
                          <span className="text-muted-foreground tabular-nums">
                            {formatUsd(p.setPrice)}
                          </span>
                        )
                      )}
                    </button>
                  )
                })}
              </div>
              {picked && (
                <ActionRow
                  cardId={cardId}
                  name={nameOf(cardName, picked.printing)}
                  label={picked.label}
                  printing={picked.printing}
                  rows={rowsOf.get(picked.printing.id) ?? []}
                  stepper={stepper}
                  wished={wished(picked.printing.id)}
                />
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** The selected pill's wish heart and −/count/+, under its set's row. */
function ActionRow({
  cardId,
  name,
  label,
  printing,
  rows,
  stepper,
  wished
}: {
  cardId: number
  name: string
  label: string
  printing: Printing
  rows: CardTypeRow[]
  stepper: (row: CardTypeRow, label: string) => React.ReactNode
  wished: boolean
}): React.JSX.Element {
  // Only a printing's one original-art row goes through its pill; other rows are entries of
  // their own, edited where they're listed in Your copies.
  const only = rows.length === 1 && rows[0].viaPrinting ? rows[0] : undefined
  return (
    <div
      role="group"
      aria-label={name}
      className="mt-1 flex flex-wrap items-center gap-1.5 rounded-md bg-white/[0.04] py-1 pl-2 pr-1"
    >
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      <WishToggle cardId={cardId} printingId={printing.id} wanted={wished} label={name} />
      {only ? (
        stepper(only, name)
      ) : (
        <span className="text-muted-foreground">Edit in your copies above</span>
      )}
    </div>
  )
}
