import { ChevronLeftIcon, MoreHorizontalIcon } from 'lucide-react'
import type { DeckVerdict } from '@shared/decks/check'
import { MAX_DECK_NAME } from '@shared/decks/fields'
import type { DeckFormat } from '@shared/decks/formats'
import type { DeckCard, DeckFields } from '@shared/decks/types'
import type { GameId } from '@shared/games'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { BADGE, CHIP } from './deckEntries'
import { ExportMenu } from './ExportMenu'
import { FormatSelect } from './FormatSelect'

const DOT: Record<string, string> = {
  legal: 'bg-complete',
  warnings: 'bg-amber-400',
  illegal: 'bg-destructive',
  unknown: 'bg-muted-foreground/60',
  update: 'bg-muted-foreground/60'
}

export interface DeckMenu {
  onReplace: () => void
  onDuplicate: () => void
  onDelete: () => void
  onPrivate: (on: boolean) => void
}

/**
 * The deck's top line: Back, its name, format and legality, Export and a menu of the rarer
 * actions. Deleting asks first, here in the header.
 */
export function DeckHeader({
  game,
  fields,
  facts,
  known,
  editable,
  readOnly,
  verdict,
  busy,
  confirmingDelete,
  onBack,
  onName,
  onFormat,
  onBadge,
  menu,
  onConfirmDelete,
  onKeep
}: {
  game: GameId
  fields: DeckFields
  facts: Record<number, DeckCard>
  known: DeckFormat | null
  editable: boolean
  readOnly: boolean
  verdict: DeckVerdict | null
  busy: boolean
  confirmingDelete: boolean
  onBack: () => void
  onName: (name: string) => void
  onFormat: (format: string) => void
  /** The legality chip was clicked: show every problem. */
  onBadge: () => void
  menu: DeckMenu
  onConfirmDelete: () => void
  onKeep: () => void
}): React.JSX.Element {
  const problems = verdict?.problems.length ?? 0
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button variant="ghost" size="sm" className="-ml-2 shrink-0" onClick={onBack}>
          <ChevronLeftIcon className="size-4" />
          Back
        </Button>
        {editable ? (
          <input
            aria-label="Deck name"
            value={fields.name}
            maxLength={MAX_DECK_NAME}
            onChange={(e) => onName(e.target.value)}
            size={Math.max(8, Math.min(fields.name.length + 1, 40))}
            className="min-w-0 max-w-full rounded-md bg-transparent px-1 font-display text-3xl leading-tight outline-none hover:bg-chip/50 focus-visible:ring-2 focus-visible:ring-ring"
          />
        ) : (
          <h1 className="min-w-0 truncate px-1 font-display text-3xl leading-tight">
            {fields.name}
          </h1>
        )}
        {editable ? (
          <FormatSelect
            game={game}
            size="sm"
            value={fields.format}
            onChange={onFormat}
            className="w-auto rounded-full border-0 bg-chip font-mono text-xs"
          />
        ) : (
          <span className={cn(CHIP, 'text-muted-foreground')}>{known?.label ?? fields.format}</span>
        )}
        {verdict && (
          <button
            type="button"
            onClick={onBadge}
            disabled={problems === 0}
            title={problems > 0 ? 'Show every problem' : undefined}
            className={cn(
              CHIP,
              'outline-none focus-visible:ring-2 focus-visible:ring-ring enabled:hover:bg-chip/70',
              BADGE[verdict.status]
            )}
          >
            <span aria-hidden className={cn('size-1.5 rounded-full', DOT[verdict.status])} />
            <span>{verdict.badge}</span>
            {verdict.status === 'illegal' && problems > 0 && (
              <span aria-label={`${problems} problems`}>{`· ${problems}`}</span>
            )}
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          {confirmingDelete ? (
            <span className="flex items-center gap-2 text-sm">
              <span>Delete this deck?</span>
              <Button variant="destructive" size="sm" disabled={busy} onClick={onConfirmDelete}>
                Confirm delete
              </Button>
              <Button variant="ghost" size="sm" onClick={onKeep}>
                Keep
              </Button>
            </span>
          ) : (
            <>
              <ExportMenu game={game} name={fields.name} cards={fields.cards} facts={facts} />
              {!readOnly && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="More deck actions">
                      <MoreHorizontalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {editable && (
                      <>
                        <DropdownMenuCheckboxItem
                          checked={fields.private}
                          onCheckedChange={(c) => menu.onPrivate(c === true)}
                        >
                          Private
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuItem onSelect={menu.onReplace}>
                          Replace from list
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={busy} onSelect={menu.onDuplicate}>
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuItem variant="destructive" onSelect={menu.onDelete}>
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** The counts under the header: each section against its limits, what you own and what's left to buy. */
export function DeckStatChips({
  format,
  counts,
  own,
  total,
  missing,
  onMissing
}: {
  format: DeckFormat
  counts: Record<string, number>
  own: number
  total: number
  /** The missing copies' price, or null when every copy is owned. */
  missing: string | null
  onMissing: () => void
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {format.sections.map((s) => {
        const n = counts[s.id] ?? 0
        const out = n < s.min || n > s.max
        return (
          <span key={s.id} className={CHIP}>
            <span className="text-muted-foreground">{s.label.replace(/ Deck$/, '')}</span>
            <span className={cn('font-semibold', out && 'text-destructive')}>{n}</span>
            <span className="text-muted-foreground">
              {s.max === Infinity
                ? `/ ${s.min}+`
                : s.min > 0
                  ? `/ ${s.min}–${s.max}`
                  : `/ ${s.max}`}
            </span>
          </span>
        )
      })}
      <span className={cn(CHIP, own >= total && total > 0 && 'text-complete')}>
        {`Own ${own} of ${total}`}
      </span>
      {missing !== null && (
        <button
          type="button"
          onClick={onMissing}
          className={cn(
            CHIP,
            'outline-none hover:bg-chip/70 focus-visible:ring-2 focus-visible:ring-ring'
          )}
        >
          {`Missing ${missing}`}
        </button>
      )}
    </div>
  )
}
