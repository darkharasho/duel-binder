import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { toast } from 'sonner'
import type { BinderCard, BinderDetail } from '@shared/types'
import {
  MAX_PLACEHOLDERS,
  PLACEHOLDER_STYLES,
  sheetCount,
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
import { useGame } from '@/lib/game'
import { binderPlaceholders } from './placeholderCards'

const plural = (n: number, one: string): string =>
  `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`

/** Prints pockets for a binder's slots, in the order the binder shows them: missing ones, or all. */
export function BinderPlaceholdersButton({
  detail,
  cards
}: {
  detail: BinderDetail
  /** The binder's slots in display order. */
  cards: readonly BinderCard[]
}): React.JSX.Element {
  const { game } = useGame()
  const [open, setOpen] = useState(false)
  const hasGoal = detail.goal !== 'none'
  const [scope, setScope] = useState<'missing' | 'all'>(hasGoal ? 'missing' : 'all')
  const [style, setStyle] = useState<PlaceholderStyle>('soft')
  const all = binderPlaceholders(cards, game)
  const missing = binderPlaceholders(
    cards.filter((c) => c.owned === 0),
    game
  )
  const chosen = hasGoal && scope === 'missing' ? missing : all
  const tooMany = chosen.length > MAX_PLACEHOLDERS

  const save = useMutation({
    mutationFn: () =>
      api.placeholders.save({ setName: detail.name, setCode: '', style, cards: chosen }),
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
              A PDF of true-size cards for {detail.name}, nine to a Letter sheet, in the
              binder&apos;s current order. Print at 100%.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {hasGoal && (
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
              {tooMany
                ? `${plural(chosen.length, 'card')} is more than one PDF holds (${MAX_PLACEHOLDERS.toLocaleString()}). Narrow the binder to print it.`
                : `${plural(chosen.length, 'card')} on ${plural(sheetCount(chosen.length), 'sheet')}.`}
            </p>
          </div>
          <DialogFooter>
            <Button
              disabled={chosen.length === 0 || tooMany || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Making PDF…' : 'Save PDF'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
