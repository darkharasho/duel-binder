import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { toast } from 'sonner'
import type { ChecklistCard, SetSummary } from '@shared/types'
import {
  PLACEHOLDER_STYLES,
  sheetCount,
  type PlaceholderCard,
  type PlaceholderStyle
} from '@shared/placeholders'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api } from '@/lib/api'
import { versionCounts } from './setsView'

const toPlaceholder = (c: ChecklistCard): PlaceholderCard => ({
  imageId: c.imageId,
  name: c.name,
  number: c.rarities[0]?.codes[0]?.setCode ?? c.numberLabel,
  rarity: c.cardRarity ?? null
})

/**
 * One pocket per finish of a Pokémon card, in the set's finish order: a reverse holo has a pocket
 * of its own in a master set binder. Missing means that finish isn't owned.
 */
function finishPockets(
  cards: ChecklistCard[],
  order: string[],
  picked: string[],
  missingOnly: boolean
): PlaceholderCard[] {
  const rank = (v: string): number => order.indexOf(v)
  return cards.flatMap((c) =>
    c.rarities
      .filter((r) => picked.includes(r.rarity) && (!missingOnly || r.owned === 0))
      .sort((a, b) => rank(a.rarity) - rank(b.rarity))
      .map((r) => ({
        ...toPlaceholder(c),
        number: r.codes[0]?.setCode ?? c.numberLabel,
        finish: r.rarity
      }))
  )
}

const plural = (n: number, one: string): string =>
  `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`

/** Prints pockets for a binder: this set's missing cards, or all of them. */
export function PlaceholdersButton({
  set,
  cards
}: {
  set: SetSummary
  cards: ChecklistCard[]
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<'missing' | 'all'>('missing')
  const [style, setStyle] = useState<PlaceholderStyle>('soft')
  const ordered = [...cards].sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity))
  // A Pokémon set's finishes; a set of one finish (and Yu-Gi-Oh!) prints a pocket per card.
  const versions = versionCounts({ set, cards }).map((v) => v.version)
  const byFinish = versions.length > 1
  const [finishes, setFinishes] = useState<string[]>(versions)
  const picked = finishes.filter((f) => versions.includes(f))
  const missing = byFinish
    ? finishPockets(ordered, versions, picked, true)
    : ordered.filter((c) => c.owned === 0).map(toPlaceholder)
  const all = byFinish
    ? finishPockets(ordered, versions, picked, false)
    : ordered.map(toPlaceholder)
  const chosen = scope === 'missing' ? missing : all

  const save = useMutation({
    mutationFn: () =>
      api.placeholders.save({
        setName: set.setName,
        setCode: set.setCode,
        style,
        cards: chosen
      }),
    onSuccess: (path) => {
      if (!path) return
      toast.success(`Saved to ${path}`)
      setOpen(false)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not make the PDF')
  })

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Printer />
        Placeholders
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Binder placeholders</DialogTitle>
            <DialogDescription>
              A PDF of true-size cards for {set.setName}, nine to a Letter sheet. Print at 100%.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              aria-label="Cards to print"
              value={scope}
              onValueChange={(v) => {
                if (v === 'missing' || v === 'all') setScope(v)
              }}
            >
              <ToggleGroupItem value="missing">Missing ({missing.length})</ToggleGroupItem>
              <ToggleGroupItem value="all">All ({all.length})</ToggleGroupItem>
            </ToggleGroup>
            {byFinish && (
              <ToggleGroup
                type="multiple"
                variant="outline"
                size="sm"
                aria-label="Finishes"
                className="flex-wrap"
                value={picked}
                onValueChange={setFinishes}
              >
                {versions.map((v) => (
                  <ToggleGroupItem key={v} value={v}>
                    {v}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              aria-label="Art style"
              value={style}
              onValueChange={(v) => {
                if (v) setStyle(v as PlaceholderStyle)
              }}
            >
              {Object.entries(PLACEHOLDER_STYLES).map(([value, s]) => (
                <ToggleGroupItem key={value} value={value}>
                  {s.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="text-muted-foreground">
              {plural(chosen.length, 'card')} on {plural(sheetCount(chosen.length), 'sheet')}.
            </p>
          </div>
          <DialogFooter>
            <Button disabled={chosen.length === 0 || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Making PDF…' : 'Save PDF'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
