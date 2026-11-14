import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { CardSearchResult, Printing } from '@shared/types'
import { api, invalidateAfterEdit, queryKeys } from '@/lib/api'
import { track } from '@/lib/usage'
import { priceFor } from '@shared/pricing'
import {
  printingChip,
  printingText,
  printingParts,
  type PrintingLabelInput
} from '@shared/printingLabel'
import { englishSetName } from '@shared/setNames'
import { LANGUAGES, type LanguageFilter } from '@shared/languages'
import { ValueText } from '@/features/collection/EntryValue'
import { cn } from '@/lib/utils'
import { CardArt } from '@/components/CardArt'
import { useReverseLook } from '@/components/useReverseLook'
import { LanguageSelect } from '@/components/LanguageSelect'
import { LanguageTag } from '@/components/LanguageTag'
import { PrintingLabel } from '@/components/PrintingLabel'
import { matchesLanguage, useLanguageFilter } from '@/lib/languageFilter'
import { useGame } from '@/lib/game'
import { isPhone } from '@/lib/platform'
import { useSyncStatus } from '@/components/useSyncStatus'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { TooltipProvider } from '@/components/ui/tooltip'

type Step = 'search' | 'printing' | 'quantity'

interface AddCardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Start at the printing step for this card with this printing highlighted, or at the search
   * step with this text already typed.
   */
  initial?: { card: CardSearchResult; printingId: number } | { query: string } | null
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

function PrintingPrice({
  setPrice,
  cardPrice,
  english
}: {
  setPrice: number | null
  cardPrice: number | null
  english: boolean
}): React.JSX.Element {
  // A non-English printing never borrows the English (TCGplayer) price.
  const { unitPrice, approximate } = english
    ? priceFor(setPrice, cardPrice)
    : { unitPrice: null, approximate: false }
  return (
    <TooltipProvider>
      <ValueText amount={unitPrice} approximate={approximate} />
    </TooltipProvider>
  )
}

export function AddCardDialog({
  open,
  onOpenChange,
  initial = null
}: AddCardDialogProps): React.JSX.Element {
  const qc = useQueryClient()
  const sync = useSyncStatus()
  const { def } = useGame()
  const [step, setStep] = useState<Step>('search')
  const [text, setText] = useState('')
  const [card, setCard] = useState<CardSearchResult | null>(null)
  const [printing, setPrinting] = useState<Printing | null>(null)
  const [quantity, setQuantity] = useState('1')
  const [preferredId, setPreferredId] = useState<number | null>(null)
  const [seeded, setSeeded] = useState<AddCardDialogProps['initial']>(null)
  const [highlight, setHighlight] = useState<string | undefined>()
  // The dialog's own copy of the language filter: null until the user picks, then it follows the
  // shared setting (or the language of the printing the dialog was opened on).
  const [sharedLanguage] = useLanguageFilter()
  const [pickedLanguage, setPickedLanguage] = useState<LanguageFilter | null>(null)

  const q = useDebounced(text.trim(), 200)
  // Results belong to `q`; never show or select them while the typed text is ahead of it.
  const settled = text.trim() === q
  const search = useQuery({
    queryKey: queryKeys.search(q),
    queryFn: () => api.cards.search(q),
    enabled: open && q !== ''
  })
  const detail = useQuery({
    queryKey: queryKeys.card(card?.id ?? 0),
    queryFn: () => api.cards.get(card!.id),
    enabled: open && card !== null
  })
  const owned = useQuery({
    queryKey: queryKeys.forCard(card?.id ?? 0),
    queryFn: () => api.collection.forCard(card!.id),
    enabled: open && card !== null
  })

  const printings = (detail.data?.printings ?? []).filter((p) => !p.missingFromApi)
  const images = [...(detail.data?.images ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)
  // Users don't pick artwork: the printing's own scan shows it. The stored art is the fallback
  // when the printing has no scan: a copy already owned keeps its art (so the add tops it up
  // instead of starting a second entry), then a One Piece version's own art, otherwise the
  // card's original art.
  const imageId = (p: Printing | null): number =>
    owned.data?.find((e) => p !== null && e.printing.id === p.id)?.imageId ??
    p?.artImageId ??
    images[0]?.imageId ??
    card!.defaultImageId
  const labelOf = (p: Printing): PrintingLabelInput => ({
    setCode: p.setCode,
    setName: p.setName,
    rarity: p.setRarity
  })
  const reverse = useReverseLook(
    { cardId: card?.id ?? 0, imageId: card ? imageId(printing) : 0 },
    printing?.setRarity,
    printing?.setCode
  )
  const printingValue = (p: Printing): string =>
    `${p.id} ${englishSetName(p.setName, p.setCode)} ${p.setName} ${p.setCode} ${p.setRarity} ${p.language}`
  const preferred = printings.find((p) => p.id === preferredId)
  const languageFilter = pickedLanguage ?? preferred?.language ?? sharedLanguage
  const availableLanguages = LANGUAGES.map((l) => l.code).filter((code) =>
    printings.some((p) => p.language === code)
  )
  const languageLabel =
    languageFilter === 'all' ? '' : (LANGUAGES.find((l) => l.code === languageFilter)?.label ?? '')
  const shownPrintings = printings.filter((p) => matchesLanguage(languageFilter, p.language))
  const highlighted = highlight ?? (preferred ? printingValue(preferred) : undefined)
  const qty = Number(quantity)
  const qtyValid = quantity.trim() !== '' && Number.isInteger(qty) && qty >= 1

  const reset = (): void => {
    setStep('search')
    setText('')
    setCard(null)
    setPrinting(null)
    setQuantity('1')
    setPreferredId(null)
    setPickedLanguage(null)
    setHighlight(undefined)
  }

  const add = useMutation({
    mutationFn: () =>
      api.collection.add({ printingId: printing!.id, imageId: imageId(printing), quantity: qty }),
    onSuccess: () => {
      void invalidateAfterEdit(qc)
      toast.success(`Added ${qty} × ${card!.name} (${printing!.setCode})`)
      track('card:add')
      reset()
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not add card')
  })

  const goBack = (): void => {
    if (step === 'quantity') setStep('printing')
    else if (step === 'printing') {
      setStep('search')
      setPrinting(null)
    }
  }

  const pickCard = (c: CardSearchResult): void => {
    setCard(c)
    setPreferredId(null)
    setPickedLanguage(null)
    setHighlight(undefined)
    setStep('printing')
  }

  const pickPrinting = (p: Printing): void => {
    setPrinting(p)
    setStep('quantity')
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Backspace' || e.repeat) return
    const el = e.target as HTMLElement
    if (el instanceof HTMLInputElement && el.value !== '') return
    if (step === 'search') return
    e.preventDefault()
    goBack()
  }

  // Seed from `initial` once per open (adjusting state during render, not in an effect).
  if (!open && seeded !== null) {
    setSeeded(null)
  } else if (open && initial && seeded !== initial) {
    setSeeded(initial)
    setPrinting(null)
    setHighlight(undefined)
    setPickedLanguage(null)
    if ('query' in initial) {
      setCard(null)
      setText(initial.query)
      setPreferredId(null)
      setStep('search')
    } else {
      setCard(initial.card)
      setText('')
      setPreferredId(initial.printingId)
      setStep('printing')
    }
  }

  const downloading = sync?.cardCount === 0
  // On the phone the dialog fills the screen, so its lists can grow to the space left.
  const phone = isPhone()
  const listClass = phone ? 'max-h-none flex-1' : 'max-h-[26rem]'
  const commandClass = phone ? 'min-h-0 flex-1 rounded-none' : 'rounded-none'
  // The search underline: Bricolage at 22 px, italic placeholder (the Input primitive's field).
  const inputWrapClass =
    'h-auto gap-3 border-b-[1.5px] border-foreground px-0 focus-within:border-b-[3px]'
  const inputClass =
    'font-display h-12 rounded-none py-0 text-[22px] placeholder:italic placeholder:text-muted-foreground'
  const itemClass =
    'gap-4 rounded-full px-3 py-2 text-base data-[selected=true]:bg-chip data-[selected=true]:text-foreground'
  const emptyClass = 'py-8 text-center text-base text-foreground'
  const gameLabel = (
    <p className="font-mono text-[11px] tracking-[0.14em] text-foreground uppercase">
      {def.name}
    </p>
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent
        className={
          phone
            ? 'inset-0 top-0 left-0 flex h-dvh max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100 sm:max-w-none'
            : 'top-[18%] translate-y-0 gap-0 overflow-hidden rounded-2xl border-0 bg-popover p-0 shadow-2xl sm:max-w-[720px]'
        }
        overlayClassName={phone ? undefined : 'bg-black/60 backdrop-blur-sm'}
        data-layout={phone ? 'full-screen' : undefined}
        showCloseButton={!phone}
        onKeyDown={onKeyDown}
      >
        <DialogHeader
          className={phone ? 'flex-row items-center gap-1 border-b px-2 py-1' : 'sr-only'}
        >
          {phone && step !== 'search' && (
            <Button variant="ghost" size="icon" aria-label="Back" onClick={goBack}>
              <ChevronLeft />
            </Button>
          )}
          <DialogTitle className={phone ? 'flex-1 px-2 text-base' : undefined}>
            Add card
          </DialogTitle>
          <DialogDescription className={phone ? 'sr-only' : undefined}>
            Search for a card, then choose its printing and quantity.
          </DialogDescription>
          {phone && (
            <DialogClose asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <XIcon />
              </Button>
            </DialogClose>
          )}
        </DialogHeader>

        {card && step !== 'search' && (
          <div className={cn('flex items-center gap-4 border-b px-5 py-4', !phone && 'pr-12')}>
            <CardArt
              imageId={imageId(printing)}
              printingId={printing?.id}
              reverse={reverse}
              size="small"
              alt=""
              className="w-12"
            />
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{card.name}</p>
              <p className="truncate font-mono text-xs text-foreground">
                {printing ? printingText(labelOf(printing)) : card.type}
              </p>
            </div>
          </div>
        )}

        {step === 'search' &&
          (downloading ? (
            <p className="px-6 py-10 text-center text-base text-foreground">
              {sync?.state === 'error'
                ? "Couldn't download the card database. Check your connection and retry from the banner."
                : 'Card database is still downloading'}
            </p>
          ) : (
            <Command shouldFilter={false} className={commandClass}>
              <div className="px-5 pt-5 pb-1">{gameLabel}</div>
              <CommandInput
                wrapperClassName={cn(inputWrapClass, 'mx-5')}
                className={inputClass}
                autoFocus
                placeholder={`Search cards by name or ${def.vocab.printingCode.toLowerCase()}…`}
                value={text}
                onValueChange={setText}
              />
              <CommandList className={listClass}>
                {text.trim() !== '' && (!settled || search.isFetching) && (
                  <p className={emptyClass}>Searching…</p>
                )}
                {settled && q !== '' && !search.isFetching && (search.data?.length ?? 0) === 0 && (
                  <CommandEmpty className={emptyClass}>No cards found.</CommandEmpty>
                )}
                <CommandGroup className="px-3 py-3">
                  {(!settled || q === '' ? [] : (search.data ?? [])).map((c) => (
                    <CommandItem
                      key={c.id}
                      value={String(c.id)}
                      onSelect={() => pickCard(c)}
                      className={itemClass}
                    >
                      <CardArt
                        imageId={c.defaultImageId}
                        size="small"
                        alt=""
                        className="w-12 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate font-semibold">{c.name}</span>
                          {c.language && <LanguageTag language={c.language} className="shrink-0" />}
                        </span>
                        <span className="block truncate font-mono text-xs text-foreground">
                          {c.localName ? `${c.localName} · ${c.type}` : c.type}
                        </span>
                      </span>
                      {c.matchedSetCode && (
                        <span className="font-mono text-xs tabular-nums text-foreground">
                          {c.matchedSetCode}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          ))}

        {step === 'printing' && (
          <Command className={commandClass} value={highlighted} onValueChange={setHighlight}>
            <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-1">
              {gameLabel}
              <LanguageSelect
                value={languageFilter}
                onChange={setPickedLanguage}
                available={availableLanguages}
              />
            </div>
            <CommandInput
              wrapperClassName={cn(inputWrapClass, 'mx-5')}
              className={inputClass}
              autoFocus
              placeholder="Filter printings…"
            />
            <CommandList className={listClass}>
              <CommandEmpty className={emptyClass}>
                {detail.isLoading
                  ? 'Loading…'
                  : printings.length > 0
                    ? `No ${languageLabel} printings — choose another language above.`
                    : 'No printings available.'}
              </CommandEmpty>
              <CommandGroup className="px-3 py-3">
                {shownPrintings.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={printingValue(p)}
                    onSelect={() => pickPrinting(p)}
                    className={itemClass}
                  >
                    <PrintingLabel
                      chip={printingChip(labelOf(p))}
                      {...printingParts(labelOf(p))}
                      tag={<LanguageTag language={p.language} />}
                    />
                    <span className="w-20 text-right font-mono text-sm">
                      <PrintingPrice
                        setPrice={p.setPrice}
                        cardPrice={detail.data?.card.tcgplayerPrice ?? null}
                        english={p.language === 'en'}
                      />
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        )}

        {step === 'quantity' && (
          <form
            className="flex items-end gap-4 px-5 py-6"
            onSubmit={(e) => {
              e.preventDefault()
              if (qtyValid && !add.isPending) add.mutate()
            }}
          >
            <label className="grid gap-1.5 font-mono text-[11px] tracking-[0.14em] uppercase">
              Quantity
              <Input
                autoFocus
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-28 font-mono text-xl tabular-nums"
              />
            </label>
            <Button type="submit" className="rounded-full px-6" disabled={!qtyValid || add.isPending}>
              Save
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
