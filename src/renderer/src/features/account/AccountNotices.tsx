import { useAccountUser } from '@/lib/accountUser'
import { LinkHint } from './LinkHint'
import { UsernamePrompt } from './UsernamePrompt'

/** The link hint, and the username prompt (a dialog), for whoever is signed in. */
export function AccountNotices(): React.JSX.Element {
  const { user } = useAccountUser()
  return (
    <>
      <LinkHint user={user} />
      <UsernamePrompt user={user} />
    </>
  )
}
