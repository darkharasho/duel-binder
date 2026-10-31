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

const toPlaceholder = (c: ChecklistCard): PlaceholderCard => ({
  imageId: c.imageId,
  name: c.name,
  number: c.rarities[0]?.codes[0]?.setCode ?? c.numberLabel,
  rarity: c.cardRarity ?? null
})

const plural = (n: number, one: string): string => `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`

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
  const missing = ordered.filter((c) => c.owned === 0)
  const chosen = scope === 'missing' ? missing : ordered

  const save = useMutation({
    mutationFn: () =>
      api.placeholders.save({
        setName: set.setName,
        setCode: set.setCode,
        style,
        cards: chosen.map(toPlaceholder)
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
              <ToggleGroupItem value="all">All ({ordered.length})</ToggleGroupItem>
            </ToggleGroup>
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
