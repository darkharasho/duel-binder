import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, Plus } from 'lucide-react'
import { Popover } from 'radix-ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { CardSearchResult } from '@shared/types'
import type { ScanDraft, ScanPrinting } from '@shared/scan/types'
import type { GameId } from '@shared/games/types'
import { api, queryKeys } from '@/lib/api'
import { useGame } from '@/lib/game'
import { Button } from '@/components/ui/button'
import { CardArt } from '@/components/CardArt'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { PrintingPanel } from './PrintingPicker'
import { groupPrintings } from './printingGroups'
import { choicesFor } from './ScanRowItem'
import { useScanLanguage } from './pickerOptions'
import { useScanHub } from './ScanHub'
import type { ScanRow } from './session'

const SEARCH_WAIT_MS = 200

/** The draft a card picked by hand becomes: that printing, sure, among all the card's printings. */
// eslint-disable-next-line react-refresh/only-export-components -- exported for its tests
export function handDraft(
  p: ScanPrinting,
  options: ScanPrinting[],
  game: GameId,
  fallbackImageId: number
): ScanDraft {
  return {
    cardId: p.cardId,
    name: p.name,
    imageId: p.imageIds[0] ?? fallbackImageId,
    printingId: p.printingId,
    setCode: p.setCode,
    rarity: p.rarity,
    options,
    flag: null,
    via: 'name',
    ...(game === 'ygo' ? {} : { game })
  }
}

interface Picking {
  card: CardSearchResult
  options: ScanPrinting[]
}

/**
 * Adds a card the scanner missed, by name or code: it goes on the list as a scan would, and the
 * open scan window pops it up as if it had scanned it. A card of several printings asks which.
 */
export function AddByHand(): React.JSX.Element {
  const { addByHand } = useScanHub()
  const { game } = useGame()
  const language = useScanLanguage()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [picking, setPicking] = useState<Picking | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), SEARCH_WAIT_MS)
    return () => clearTimeout(t)
  }, [text])
  const search = useQuery({
    queryKey: queryKeys.search(q),
    queryFn: () => api.cards.search(q),
    enabled: open && q !== ''
  })
  const settled = text.trim() === q

  const reset = (): void => {
    setText('')
    setQ('')
    setPicking(null)
    setFailed(false)
  }
  const onOpenChange = (next: boolean): void => {
    setOpen(next)
    if (!next) reset()
  }

  const add = (card: CardSearchResult, p: ScanPrinting, options: ScanPrinting[]): void => {
    addByHand(handDraft(p, options, game, card.defaultImageId))
    onOpenChange(false)
  }

  const pickCard = async (card: CardSearchResult): Promise<void> => {
    setFailed(false)
    let options: ScanPrinting[]
    try {
      options = await queryClient.fetchQuery({
        queryKey: ['scan', 'byHand', card.id],
        queryFn: () => api.scan.printingsForCards([card.id])
      })
    } catch {
      setFailed(true)
      return
    }
    const own = options.filter((o) => o.cardId === card.id)
    // A version row, or a code naming one printing, says which it is.
    const named =
      own.find((o) => o.printingId === card.printingId) ??
      (card.matchedSetCode
        ? own.filter((o) => o.setCode === card.matchedSetCode).length === 1
          ? own.find((o) => o.setCode === card.matchedSetCode)
          : undefined
        : undefined)
    if (named) add(card, named, own)
    else if (own.length === 1) add(card, own[0], own)
    else if (own.length) setPicking({ card, options: own })
    else setFailed(true)
  }

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <Button variant="outline" size="sm">
          <Plus aria-hidden />
          Add by hand
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-[40rem] max-w-[calc(100vw-1rem)] rounded-md border bg-popover p-0 text-popover-foreground shadow-md"
        >
          {picking ? (
            <VersionStep
              picking={picking}
              language={language}
              game={game}
              onBack={() => setPicking(null)}
              onPick={(p) => add(picking.card, p, picking.options)}
            />
          ) : (
            <Command shouldFilter={false} label="Add a card by hand" className="rounded-md">
              <CommandInput
                autoFocus
                placeholder="Search cards by name or code…"
                value={text}
                onValueChange={setText}
              />
              <CommandList className="max-h-80">
                {failed && (
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    Couldn&apos;t read that card&apos;s printings. Try again.
                  </p>
                )}
                {text.trim() !== '' && (!settled || search.isFetching) && (
                  <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>
                )}
                {settled && q !== '' && !search.isFetching && (search.data?.length ?? 0) === 0 && (
                  <CommandEmpty>No cards found.</CommandEmpty>
                )}
                <CommandGroup>
                  {(!settled || q === '' ? [] : (search.data ?? [])).map((c) => {
                    const key = c.printingId !== undefined ? `p${c.printingId}` : `c${c.id}`
                    return (
                      <CommandItem key={key} value={key} onSelect={() => void pickCard(c)}>
                        <CardArt
                          imageId={c.imageId ?? c.defaultImageId}
                          size="small"
                          alt=""
                          className="w-8 shrink-0"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{c.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {c.printingId !== undefined && c.setName
                              ? [c.setCode, c.setName, c.rarity].filter(Boolean).join(' · ')
                              : (c.localName ?? c.type)}
                          </span>
                        </span>
                        {c.matchedSetCode && (
                          <span className="font-mono text-xs tabular-nums">{c.matchedSetCode}</span>
                        )}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function VersionStep({
  picking,
  language,
  game,
  onBack,
  onPick
}: {
  picking: Picking
  language: ReturnType<typeof useScanLanguage>
  game: GameId
  onBack: () => void
  onPick: (p: ScanPrinting) => void
}): React.JSX.Element {
  const { card, options } = picking
  // Listed as a scan row lists them, so the scan language narrows them the same way.
  const groups = useMemo(() => {
    const row = {
      ...handDraft(options[0], options, game, card.defaultImageId),
      printingId: null,
      key: '',
      quantity: 1,
      addedAt: 0
    } satisfies ScanRow
    return groupPrintings(choicesFor(row, language))
  }, [card, options, game, language])
  const value = card.matchedSetCode
    ? (options.find((o) => o.setCode === card.matchedSetCode)?.printingId ?? null)
    : null
  return (
    <div>
      <div className="flex items-center gap-2 border-b px-2 py-1.5">
        <Button variant="ghost" size="xs" onClick={onBack} aria-label="Back to search">
          <ChevronLeft aria-hidden />
        </Button>
        <span className="truncate text-sm font-medium">Which {card.name}?</span>
      </div>
      <PrintingPanel
        groups={groups}
        value={value === null ? null : String(value)}
        searchPlaceholder="Search code, rarity or set…"
        onPick={(key) => {
          const p = options.find((o) => String(o.printingId) === key)
          if (p) onPick(p)
        }}
      />
    </div>
  )
}
