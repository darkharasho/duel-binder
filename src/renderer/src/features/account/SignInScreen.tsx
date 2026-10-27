import logo from '@/assets/logo.svg'
import { TitleBar } from '@/components/TitleBar'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { useApplyAccountStatus } from '@/lib/account'
import type { AccountStatus } from '@shared/types'

/** Full-window gate shown instead of the app while the desktop has no signed-in account. */
export function SignInScreen({ status }: { status?: AccountStatus }): React.JSX.Element {
  const apply = useApplyAccountStatus()
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TitleBar />
      <main className="flex flex-1 items-center justify-center px-6 pb-9">
        <div className="flex w-full max-w-sm flex-col items-center gap-5 text-center">
          <img src={logo} alt="" className="size-14" />
          <h1 className="text-xl font-semibold tracking-[-0.01em]">Sign in to Duel Binder</h1>
          <p className="text-sm text-muted-foreground">
            Duel Binder keeps your collection and card data in your account. Sign in with Discord to
            continue.
          </p>
          {status?.state === 'signing-in' ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm text-muted-foreground">Finish signing in in your browser…</p>
              <Button variant="outline" onClick={() => apply(api.account.signOut())}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button onClick={() => apply(api.account.signIn())}>Sign in with Discord</Button>
          )}
          {status?.error && <p className="text-sm text-destructive">{status.error}</p>}
        </div>
      </main>
    </div>
  )
}
