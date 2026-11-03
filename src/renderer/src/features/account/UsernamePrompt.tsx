import { useState } from 'react'
import type { Me } from '@shared/cloud'
import { useAccountUser } from '@/lib/accountUser'
import { UsernameDialog } from './UsernameDialog'

/** Asks once per app run for a username while the account still has one the server picked. */
export function UsernamePrompt({ user }: { user: Me | null }): React.JSX.Element | null {
  const { apply } = useAccountUser()
  const [dismissed, setDismissed] = useState(false)
  if (!user || user.usernameChosen !== false) return null
  return (
    <UsernameDialog
      user={user}
      open={!dismissed}
      onClose={() => setDismissed(true)}
      onSaved={(me) => {
        apply(me)
        setDismissed(true)
      }}
    />
  )
}
