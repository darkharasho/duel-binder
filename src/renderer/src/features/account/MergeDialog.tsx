import { useState } from 'react'
import type { AccountSummary, CardChoice, MergePreview } from '@shared/account'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useBackHandler } from '@/lib/backStack'

type Choice = { cards: CardChoice; username: 'mine' | 'theirs' }

const count = (n: number): string => `${n} card${n === 1 ? '' : 's'}`

function Account({ a, label }: { a: AccountSummary; label: string }): React.JSX.Element {
  return (
    <div className="flex-1 space-y-1 rounded-lg border p-3 text-sm">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2">
        {a.avatarUrl && <img src={a.avatarUrl} alt="" className="size-6 rounded-full" />}
        <span className="font-medium">@{a.username}</span>
      </div>
      <div className="text-muted-foreground">
        {count(a.cards)} · {a.binders} binder{a.binders === 1 ? '' : 's'} · {a.wishes} wishlist
      </div>
    </div>
  )
}

function Radio({
  name,
  value,
  checked,
  label,
  note,
  onChange
}: {
  name: string
  value: string
  checked: boolean
  label: string
  note?: string
  onChange(): void
}): React.JSX.Element {
  return (
    <div>
      <label className="flex min-h-9 items-center gap-2 text-sm">
        <input type="radio" name={name} value={value} checked={checked} onChange={onChange} />
        {label}
      </label>
      {note && <p className="pl-6 text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}

/**
 * The screen between finding another account and merging it: both accounts side by side, how the
 * cards combine (each option with the total it leaves), and whose username the account keeps.
 */
export function MergeDialog({
  preview,
  onMerge,
  onCancel
}: {
  preview: MergePreview
  onMerge(choice: Choice): Promise<void>
  onCancel(): void
}): React.JSX.Element {
  const { mine, theirs, totals } = preview
  const [cards, setCards] = useState<CardChoice>('higher')
  const [username, setUsername] = useState<'mine' | 'theirs'>('mine')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useBackHandler(true, () => {
    if (!busy) onCancel()
  })

  const merge = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await onMerge({ cards, username })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't merge the accounts")
      setBusy(false)
    }
  }
  const option = (value: CardChoice, label: string, note?: string): React.JSX.Element => (
    <Radio
      name="cards"
      value={value}
      checked={cards === value}
      label={`${label} (${count(totals[value])})`}
      note={note}
      onChange={() => setCards(value)}
    />
  )

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Merge accounts</DialogTitle>
          <DialogDescription>
            That sign-in already belongs to another account. Merge it into this one?
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Account a={mine} label="This account" />
          <Account a={theirs} label="The other account" />
        </div>
        <fieldset className="space-y-1">
          <legend className="mb-1 text-sm font-medium">Cards</legend>
          {option('higher', 'Keep the higher count')}
          {option(
            'mine',
            `Keep only @${mine.username}'s cards`,
            `@${theirs.username}'s cards won't be kept.`
          )}
          {option(
            'theirs',
            `Keep only @${theirs.username}'s cards`,
            `@${mine.username}'s cards won't be kept.`
          )}
          {option('sum', 'Add them together')}
        </fieldset>
        <fieldset className="space-y-1">
          <legend className="mb-1 text-sm font-medium">Username</legend>
          <Radio
            name="username"
            value="mine"
            checked={username === 'mine'}
            label={`@${mine.username}`}
            onChange={() => setUsername('mine')}
          />
          <Radio
            name="username"
            value="theirs"
            checked={username === 'theirs'}
            label={`@${theirs.username}`}
            onChange={() => setUsername('theirs')}
          />
        </fieldset>
        <p className="text-xs text-muted-foreground">
          Let your other devices sync first. Devices signed in as @{theirs.username} will be signed
          out; sign in again to see the merged account.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void merge()}>
            Merge accounts
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
