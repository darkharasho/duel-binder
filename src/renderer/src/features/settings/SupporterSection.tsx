import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupporterPlan, SupporterStatus } from '@shared/supporter'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { api } from '@/lib/api'
import { friendsErrorMessage } from '@/lib/friends'
import { isNativeApp } from '@/lib/portal'
import { isWeb } from '@/lib/platform'
import { SUPPORTER_KEY } from '@/lib/supporter'
import { track } from '@/lib/usage'

const SUPPORT_COPY =
  'Hosting, card art and price lookups cost money every month. Supporting keeps the app free for everyone.'

const monthYear = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
const day = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

/**
 * Stripe's pages open in the browser: a new window from the desktop and the store apps (Electron
 * and Capacitor send those out), the same tab on the web, where a window opened after a wait is
 * blocked.
 */
function go(url: string): void {
  if (isWeb() && !isNativeApp()) window.location.assign(url)
  else window.open(url, '_blank', 'noopener')
}

/**
 * Settings → Support Duel Binder: the optional supporter subscription. Nothing shows signed out,
 * nor while checkout is closed for someone who never subscribed, nor buy buttons in the store
 * apps. `frame` wraps the body in the page's own section style, so nothing renders when hidden.
 */
export function SupporterSection({
  signedIn,
  store = isNativeApp(),
  frame
}: {
  signedIn: boolean
  /** The App Store and Play builds: status and Manage only. */
  store?: boolean
  frame: (body: React.ReactNode) => React.ReactNode
}): React.ReactNode {
  const id = useId()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const status = useQuery({
    queryKey: SUPPORTER_KEY,
    queryFn: () => api.supporter.status(),
    enabled: signedIn,
    retry: false,
    // A purchase in the browser shows when the app comes back to the front.
    refetchOnWindowFocus: true
  })
  const open = useMutation({
    mutationFn: (what: SupporterPlan | 'manage') =>
      what === 'manage' ? api.supporter.manage() : api.supporter.checkout(what),
    onMutate: (what) => {
      setError(null)
      track(what === 'manage' ? 'supporter:manage' : 'supporter:checkout')
    },
    onSuccess: ({ url }) => go(url),
    onError: (e: Error) => setError(friendsErrorMessage(e))
  })
  const listed = useMutation({
    mutationFn: (on: boolean) => api.supporter.setShowOnSite(on),
    onSuccess: (s) => qc.setQueryData<SupporterStatus>(SUPPORTER_KEY, s),
    onError: (e: Error) => setError(friendsErrorMessage(e))
  })

  const s = status.data
  if (!signedIn || !s) return null
  const sup = s.supporter
  const canBuy = s.enabled && !store && !sup
  if (!sup && !canBuy && !s.hasCustomer) return null

  const manage = (
    <Button
      variant="outline"
      size="sm"
      disabled={open.isPending}
      onClick={() => open.mutate('manage')}
    >
      Manage
    </Button>
  )
  return frame(
    <div className="space-y-3 text-sm">
      {sup ? (
        <>
          <p>
            Thank you — supporter since {monthYear(sup.since)}
            {sup.cancelling && sup.until ? `. Ends ${day(sup.until)}.` : ''}
          </p>
          {manage}
          <div className="flex items-start gap-3">
            <Checkbox
              id={id}
              checked={sup.showOnSite}
              disabled={listed.isPending}
              onCheckedChange={(c) => listed.mutate(c === true)}
              className="mt-0.5"
            />
            <label htmlFor={id}>Show my name on the thanks page</label>
          </div>
        </>
      ) : canBuy ? (
        <>
          <p className="text-muted-foreground">{SUPPORT_COPY}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={open.isPending} onClick={() => open.mutate('month')}>
              $3 / month
            </Button>
            <Button size="sm" disabled={open.isPending} onClick={() => open.mutate('year')}>
              $25 / year
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Nothing is locked. Cancel any time. Payments by Stripe.
          </p>
          {s.hasCustomer && manage}
        </>
      ) : (
        manage
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
