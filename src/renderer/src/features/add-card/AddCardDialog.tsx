import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { CardSearchResult, Printing } from '@shared/types'
import { api, mutationInvalidationKeys, queryKeys } from '@/lib/api'
import { track } from '@/lib/usage'
import { priceFor } from '@shared/pricing'
import { LANGUAGES, type LanguageFilter } from '@shared/languages'
import { ValueText } from '@/features/collection/EntryValue'
import { cn } from '@/lib/utils'
import { CardArt } from '@/components/CardArt'
import { LanguageSelect } from '@/components/LanguageSelect'
import { LanguageTag } from '@/components/LanguageTag'
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

type Step = 'search' | 'printing' | 'art' | 'quantity'

interface AddCardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Start at the printing step for this card with this printing highlighted. */
  initial?: { card: CardSearchResult; printingId: number } | null
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
  const [imageId, setImageId] = useState<number | null>(null)
  const [quantity, setQuantity] = useState('1')
  const [preferredId, setPreferredId] = useState<number | null>(null)
  const [seeded, setSeeded] = useState<AddCardDialogProps['initial']>(null)
  const [highlight, setHighlight] = useState<string | undefined>()
  // The dialog's own copy of the language filter: null until the user picks, then it follows the
  // shared setting (or the language of the printing the dialog was opened on).
  const [sharedLanguage] = useLanguageFilter()
  const [pickedLanguage, setPickedLanguage] = useState<LanguageFilter | null>(null)
  const artRefs = useRef<(HTMLButtonElement | null)[]>([])

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

  const printings = (detail.data?.printings ?? []).filter((p) => !p.missingFromApi)
  const images = [...(detail.data?.images ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)
  const printingValue = (p: Printing): string =>
    `${p.id} ${p.setName} ${p.setCode} ${p.setRarity} ${p.language}`
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
    setImageId(null)
    setQuantity('1')
    setPreferredId(null)
    setPickedLanguage(null)
    setHighlight(undefined)
  }

  const add = useMutation({
    mutationFn: () =>
      api.collection.add({ printingId: printing!.id, imageId: imageId!, quantity: qty }),
    onSuccess: () => {
      for (const queryKey of mutationInvalidationKeys) void qc.invalidateQueries({ queryKey })
      toast.success(`Added ${qty} × ${card!.name} (${printing!.setCode})`)
      track('card:add')
      reset()
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not add card')
  })

  const goBack = (): void => {
    if (step === 'quantity') setStep(images.length > 1 ? 'art' : 'printing')
    else if (step === 'art') setStep('printing')
    else if (step === 'printing') {
      setStep('search')
      setPrinting(null)
    }
  }

  const pickCard = (c: CardSearchResult): void => {
    setCard(c)
    setImageId(c.defaultImageId)
    setPreferredId(null)
    setPickedLanguage(null)
    setHighlight(undefined)
    setStep('printing')
  }

  const pickPrinting = (p: Printing): void => {
    setPrinting(p)
    if (images.length > 1) {
      setImageId(images[0].imageId)
      setStep('art')
    } else {
      setImageId(images[0]?.imageId ?? card!.defaultImageId)
      setStep('quantity')
    }
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Backspace' || e.repeat) return
    const el = e.target as HTMLElement
    if (el instanceof HTMLInputElement && el.value !== '') return
    if (step === 'search') return
    e.preventDefault()
    goBack()
  }

  useEffect(() => {
    if (step !== 'art') return
    const i = images.findIndex((im) => im.imageId === imageId)
    artRefs.current[Math.max(i, 0)]?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const moveArt = (e: React.KeyboardEvent, i: number): void => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (delta === 0) return
    e.preventDefault()
    const next = (i + delta + images.length) % images.length
    setImageId(images[next].imageId)
    artRefs.current[next]?.focus()
  }

  // Seed from `initial` once per open (adjusting state during render, not in an effect).
  if (!open && seeded !== null) {
    setSeeded(null)
  } else if (open && initial && seeded !== initial) {
    setSeeded(initial)
    setCard(initial.card)
    setImageId(initial.card.defaultImageId)
    setPrinting(null)
    setText('')
    setHighlight(undefined)
    setPreferredId(initial.printingId)
    setPickedLanguage(null)
    setStep('printing')
  }

  const downloading = sync?.cardCount === 0
  // On the phone the dialog fills the screen, so its lists can grow to the space left.
  const phone = isPhone()
  const listClass = phone ? 'max-h-none flex-1' : 'max-h-80'
  const commandClass = phone ? 'min-h-0 flex-1 rounded-none' : 'rounded-xl'

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
            : 'gap-0 overflow-hidden p-0 sm:max-w-xl'
        }
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
            Search for a card, then choose its printing, art and quantity.
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
          <div className={cn('flex items-center gap-3 border-b px-4 py-3', !phone && 'pr-10')}>
            <CardArt
              imageId={imageId ?? card.defaultImageId}
              printingId={
                images.length === 0 || imageId === images[0].imageId ? printing?.id : undefined
              }
              size="small"
              alt=""
              className="w-9"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{card.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {printing
                  ? `${printing.setName} · ${printing.setCode} · ${printing.setRarity}`
                  : card.type}
              </p>
            </div>
          </div>
        )}

        {step === 'search' &&
          (downloading ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              {sync?.state === 'error'
                ? "Couldn't download the card database. Check your connection and retry from the banner."
                : 'Card database is still downloading'}
            </p>
          ) : (
            <Command shouldFilter={false} className={commandClass}>
              <CommandInput
                autoFocus
                placeholder={`Search cards by name or ${def.vocab.printingCode.toLowerCase()}…`}
                value={text}
                onValueChange={setText}
              />
              <CommandList className={listClass}>
                {text.trim() !== '' && (!settled || search.isFetching) && (
                  <p className="py-6 text-center text-sm text-muted-foreground">Searching…</p>
                )}
                {settled && q !== '' && !search.isFetching && (search.data?.length ?? 0) === 0 && (
                  <CommandEmpty>No cards found.</CommandEmpty>
                )}
                <CommandGroup>
                  {(!settled || q === '' ? [] : (search.data ?? [])).map((c) => (
                    <CommandItem
                      key={c.id}
                      value={String(c.id)}
                      onSelect={() => pickCard(c)}
                      className="gap-3 py-2"
                    >
                      <CardArt
                        imageId={c.defaultImageId}
                        size="small"
                        alt=""
                        className="w-9 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{c.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {c.type}
                        </span>
                      </span>
                      {c.matchedSetCode && (
                        <span className="text-xs tabular-nums text-muted-foreground">
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
            <div className="flex items-center justify-end border-b px-3 py-2">
              <LanguageSelect
                value={languageFilter}
                onChange={setPickedLanguage}
                available={availableLanguages}
              />
            </div>
            <CommandInput autoFocus placeholder="Filter printings…" />
            <CommandList className={listClass}>
              <CommandEmpty>
                {detail.isLoading
                  ? 'Loading…'
                  : printings.length > 0
                    ? `No ${languageLabel} printings — choose another language above.`
                    : 'No printings available.'}
              </CommandEmpty>
              <CommandGroup>
                {shownPrintings.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={printingValue(p)}
                    onSelect={() => pickPrinting(p)}
                    className="gap-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate">{p.setName}</span>
                    <LanguageTag language={p.language} />
                    <span className="text-xs tabular-nums text-muted-foreground">{p.setCode}</span>
                    <span className="text-xs text-muted-foreground">{p.setRarity}</span>
                    <span className="w-16 text-right text-xs">
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

        {step === 'art' && (
          <div className={cn('p-4', phone && 'min-h-0 flex-1 overflow-y-auto')}>
            <p className="mb-3 text-sm text-muted-foreground">
              {phone ? 'Choose the artwork.' : 'Choose the artwork. Press Enter to continue.'}
            </p>
            <div role="radiogroup" aria-label="Artwork" className="flex flex-wrap gap-3">
              {images.map((im, i) => (
                <button
                  key={im.imageId}
                  ref={(el) => {
                    artRefs.current[i] = el
                  }}
                  type="button"
                  role="radio"
                  aria-checked={im.imageId === imageId}
                  aria-label={`Artwork ${i + 1}`}
                  tabIndex={im.imageId === imageId ? 0 : -1}
                  onClick={() => {
                    setImageId(im.imageId)
                    setStep('quantity')
                  }}
                  onKeyUp={(e) => {
                    // Space only selects the radio; it must not fire the button's click.
                    if (e.key === ' ') e.preventDefault()
                  }}
                  onKeyDown={(e) => {
                    moveArt(e, i)
                    if (e.key === ' ') {
                      e.preventDefault()
                      setImageId(im.imageId)
                    }
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      setImageId(im.imageId)
                      setStep('quantity')
                    }
                  }}
                  className={cn(
                    'rounded-lg p-1 outline-none transition-transform duration-150 focus-visible:ring-2 focus-visible:ring-ring',
                    im.imageId === imageId ? 'ring-2 ring-primary' : 'opacity-80 hover:opacity-100'
                  )}
                >
                  {/* The original artwork stands for "as printed", so it shows this printing's photo. */}
                  <CardArt
                    imageId={im.imageId}
                    printingId={i === 0 ? printing?.id : undefined}
                    size="small"
                    alt=""
                    className="w-24"
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'quantity' && (
          <form
            className="flex items-end gap-3 p-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (qtyValid && !add.isPending) add.mutate()
            }}
          >
            <label className="grid gap-1.5 text-sm font-medium">
              Quantity
              <Input
                autoFocus
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-28 tabular-nums"
              />
            </label>
            <Button type="submit" disabled={!qtyValid || add.isPending}>
              Save
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
