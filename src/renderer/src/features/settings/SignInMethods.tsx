import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LAST_SIGN_IN, type MergePreview, type SignInProvider } from '@shared/account'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { AddEmailDialog, ChangeEmailDialog, ChangePasswordDialog } from './EmailDialogs'
import { UsernameDialog } from '@/features/account/UsernameDialog'
import { api } from '@/lib/api'
import { useAccountUser } from '@/lib/accountUser'

const LABEL: Record<SignInProvider, string> = {
  discord: 'Discord',
  apple: 'Apple',
  email: 'Email'
}
const KEY = ['account', 'signIns'] as const

/** Settings: the username, and the ways to sign in (remove one, or link another). */
export function SignInMethods({
  linkable = [],
  linking = false,
  onLink,
  onMerge
}: {
  linkable?: SignInProvider[]
  /** A link is in progress: the Link buttons wait. */
  linking?: boolean
  onLink?(p: SignInProvider): void
  /** Adding an email found another account to merge; the phone opens its merge screen. */
  onMerge?(ticket: string, preview: MergePreview): void
}): React.JSX.Element | null {
  const qc = useQueryClient()
  const { user, apply } = useAccountUser()
  const methods = useQuery({ queryKey: KEY, queryFn: () => api.account.signIns() })
  const [renaming, setRenaming] = useState(false)
  const [removing, setRemoving] = useState<SignInProvider | null>(null)
  const [emailDialog, setEmailDialog] = useState<'add' | 'password' | 'change' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!user) return null

  const list = methods.data ?? []
  const confirm = async (): Promise<void> => {
    if (!removing) return
    setBusy(true)
    setError(null)
    try {
      await api.account.removeSignIn(removing)
      await qc.invalidateQueries({ queryKey: KEY })
      setRemoving(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove it")
    } finally {
      setBusy(false)
    }
  }
  const close = (): void => {
    if (busy) return
    setRemoving(null)
    setError(null)
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between gap-4">
        <span>
          Username: <span className="text-muted-foreground">@{user.username}</span>
        </span>
        <Button variant="outline" size="sm" onClick={() => setRenaming(true)}>
          Change
        </Button>
      </div>
      <UsernameDialog
        user={user}
        open={renaming}
        onClose={() => setRenaming(false)}
        onSaved={(me) => {
          apply(me)
          setRenaming(false)
        }}
      />
      <ul className="space-y-2">
        {list.map((m) => (
          <li key={m.provider} className="flex items-center justify-between gap-4">
            <span>
              {LABEL[m.provider]}
              {m.provider === 'email' && m.email && ` · ${m.email}`}
            </span>
            <span className="flex flex-wrap justify-end gap-2">
              {m.provider === 'email' && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setEmailDialog('password')}>
                    Change password
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setEmailDialog('change')}>
                    Change email
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={list.length <= 1}
                title={list.length <= 1 ? LAST_SIGN_IN : undefined}
                onClick={() => setRemoving(m.provider)}
              >
                Remove
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {user.emailSignIn && methods.data && !list.some((m) => m.provider === 'email') && (
        <div>
          <Button variant="outline" size="sm" onClick={() => setEmailDialog('add')}>
            Add email
          </Button>
        </div>
      )}
      {emailDialog === 'add' && (
        <AddEmailDialog onClose={() => setEmailDialog(null)} onMerge={onMerge} />
      )}
      {emailDialog === 'password' && <ChangePasswordDialog onClose={() => setEmailDialog(null)} />}
      {emailDialog === 'change' && <ChangeEmailDialog onClose={() => setEmailDialog(null)} />}
      {linkable.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {linkable.map((p) => (
            <Button
              key={p}
              variant="outline"
              size="sm"
              disabled={linking}
              onClick={() => onLink?.(p)}
            >
              Link {LABEL[p]}
            </Button>
          ))}
        </div>
      )}
      <Dialog open={removing !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{removing && `Remove ${LABEL[removing]} sign-in?`}</DialogTitle>
            <DialogDescription>
              {removing &&
                `You won't be able to sign in with ${LABEL[removing]} until you link it again.`}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
