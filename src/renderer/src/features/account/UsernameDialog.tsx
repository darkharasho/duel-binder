import { useState } from 'react'
import { usernameProblem } from '@shared/account'
import type { Me } from '@shared/cloud'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { useBackHandler } from '@/lib/backStack'

function UsernameForm({
  user,
  onClose,
  onSaved
}: {
  user: Me
  onClose(): void
  onSaved(me: Me): void
}): React.JSX.Element {
  // A name the server made up is no starting point.
  const [name, setName] = useState(/^duelist-/.test(user.username) ? '' : user.username)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = name.trim()
  const problem = trimmed === '' ? null : usernameProblem(trimmed)
  const save = async (): Promise<void> => {
    if (busy || trimmed === '' || problem) return
    setBusy(true)
    setError(null)
    try {
      onSaved(await api.account.setUsername(trimmed))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your username")
      setBusy(false)
    }
  }
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <Input
        aria-label="Username"
        value={name}
        autoFocus
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={40}
        onChange={(e) => {
          setName(e.target.value)
          setError(null)
        }}
      />
      {(problem || error) && (
        <p role="alert" className="text-sm text-destructive">
          {problem ?? error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
          Not now
        </Button>
        <Button type="submit" disabled={busy || trimmed === '' || problem !== null}>
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Asks for a username: 3 to 20 letters, numbers, _ and -. */
export function UsernameDialog({
  user,
  open,
  onClose,
  onSaved
}: {
  user: Me
  open: boolean
  onClose(): void
  onSaved(me: Me): void
}): React.JSX.Element {
  useBackHandler(open, onClose)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Choose a username</DialogTitle>
          <DialogDescription>
            Friends find you by it. Use 3 to 20 letters, numbers, _ and -.
          </DialogDescription>
        </DialogHeader>
        <UsernameForm user={user} onClose={onClose} onSaved={onSaved} />
      </DialogContent>
    </Dialog>
  )
}
