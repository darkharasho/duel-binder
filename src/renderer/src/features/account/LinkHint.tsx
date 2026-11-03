import { XIcon } from 'lucide-react'
import type { Me } from '@shared/cloud'
import { api } from '@/lib/api'
import { useAccountUser } from '@/lib/accountUser'
import { APP_PLATFORM } from '@/lib/portal'

function hintText(hint: 'discord' | 'apple'): string {
  if (hint === 'discord') return 'Already use Duel Binder with Discord? Link it in Settings.'
  return APP_PLATFORM === 'ios'
    ? 'Already use Duel Binder with Apple? Link it in Settings.'
    : 'Used Duel Binder with Apple on iPhone? Link it from Settings on your iPhone.'
}

/** Suggests linking the other sign-in on a new account; the × stops the suggestion for good. */
export function LinkHint({ user }: { user: Me | null }): React.JSX.Element | null {
  const { apply } = useAccountUser()
  if (!user?.linkHint) return null
  const dismiss = (): void => {
    api.account
      .dismissLinkHint()
      .then(apply)
      .catch(() => {})
  }
  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-between gap-3 border-b bg-muted/50 px-4 py-2 text-sm"
    >
      <span>{hintText(user.linkHint)}</span>
      <button
        type="button"
        aria-label="Dismiss"
        className="rounded p-1 text-muted-foreground hover:text-foreground"
        onClick={dismiss}
      >
        <XIcon className="size-4" />
      </button>
    </div>
  )
}
