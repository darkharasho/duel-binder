import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { CardSearchResult, Printing } from '@shared/types'
import { api, mutationInvalidationKeys, queryKeys } from '@/lib/api'
import { formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CardArt } from '@/components/CardArt'
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
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

type Step = 'search' | 'printing' | 'art' | 'quantity'

interface AddCardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

export function AddCardDialog({ open, onOpenChange }: AddCardDialogProps): React.JSX.Element {
  const qc = useQueryClient()
  const sync = useSyncStatus()
  const [step, setStep] = useState<Step>('search')
  const [text, setText] = useState('')
  const [card, setCard] = useState<CardSearchResult | null>(null)
  const [printing, setPrinting] = useState<Printing | null>(null)
  const [imageId, setImageId] = useState<number | null>(null)
  const [quantity, setQuantity] = useState('1')
  const artRefs = useRef<(HTMLButtonElement | null)[]>([])

  const q = useDebounced(text.trim(), 200)
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
  const qty = Number(quantity)
  const qtyValid = quantity.trim() !== '' && Number.isInteger(qty) && qty >= 1

  const reset = (): void => {
    setStep('search')
    setText('')
    setCard(null)
    setPrinting(null)
    setImageId(null)
    setQuantity('1')
  }

  const add = useMutation({
    mutationFn: () =>
      api.collection.add({ printingId: printing!.id, imageId: imageId!, quantity: qty }),
    onSuccess: () => {
      for (const queryKey of mutationInvalidationKeys) void qc.invalidateQueries({ queryKey })
      toast.success(`Added ${qty} × ${card!.name} (${printing!.setCode})`)
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
    if (e.key !== 'Backspace') return
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

  const downloading = sync?.cardCount === 0

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl" onKeyDown={onKeyDown}>
        <DialogHeader className="sr-only">
          <DialogTitle>Add card</DialogTitle>
          <DialogDescription>
            Search for a card, then choose its printing, art and quantity.
          </DialogDescription>
        </DialogHeader>

        {card && step !== 'search' && (
          <div className="flex items-center gap-3 border-b px-4 py-3 pr-10">
            <CardArt imageId={imageId ?? card.defaultImageId} size="small" alt="" className="w-9" />
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
              Card database is still downloading
            </p>
          ) : (
            <Command shouldFilter={false} className="rounded-xl">
              <CommandInput
                autoFocus
                placeholder="Search cards by name or set code…"
                value={text}
                onValueChange={setText}
              />
              <CommandList className="max-h-80">
                {q !== '' && !search.isFetching && (search.data?.length ?? 0) === 0 && (
                  <CommandEmpty>No cards found.</CommandEmpty>
                )}
                <CommandGroup>
                  {(q === '' ? [] : (search.data ?? [])).map((c) => (
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
          <Command className="rounded-xl">
            <CommandInput autoFocus placeholder="Filter printings…" />
            <CommandList className="max-h-80">
              <CommandEmpty>
                {detail.isLoading ? 'Loading…' : 'No printings available.'}
              </CommandEmpty>
              <CommandGroup>
                {printings.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={`${p.id} ${p.setName} ${p.setCode} ${p.setRarity}`}
                    onSelect={() => pickPrinting(p)}
                    className="gap-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate">{p.setName}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{p.setCode}</span>
                    <span className="text-xs text-muted-foreground">{p.setRarity}</span>
                    <span className="w-16 text-right text-xs tabular-nums">
                      {formatUsd(p.setPrice)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        )}

        {step === 'art' && (
          <div className="p-4">
            <p className="mb-3 text-sm text-muted-foreground">
              Choose the artwork. Press Enter to continue.
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
                  onKeyDown={(e) => {
                    moveArt(e, i)
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
                  <CardArt imageId={im.imageId} size="small" alt="" className="w-24" />
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
