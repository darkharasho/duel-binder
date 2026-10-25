import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { fetchMe } from '@/web/account'

export function AccountSection(): React.JSX.Element {
  const me = useQuery({ queryKey: ['me'], queryFn: () => fetchMe() })

  if (me.isPending) return <p className="text-sm text-muted-foreground">Loading account…</p>
  if (me.isError) return <p className="text-sm text-destructive">Couldn&apos;t load your account</p>
  if (!me.data) {
    return (
      <p className="flex gap-3 text-sm text-muted-foreground">
        <span>Not signed in</span>
        <a href="/" className="underline underline-offset-2 hover:text-foreground">
          Sign in
        </a>
      </p>
    )
  }
  const { avatarUrl, displayName, username } = me.data
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <div className="flex items-center gap-3">
        {avatarUrl && <img src={avatarUrl} alt="" className="size-8 rounded-full" />}
        <span>Signed in as {displayName ?? username}</span>
      </div>
      <form method="post" action="/auth/logout">
        <Button type="submit" variant="outline" size="sm">
          Sign out
        </Button>
      </form>
    </div>
  )
}
