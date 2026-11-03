import { useCallback, useContext } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Me } from '@shared/cloud'
import { PhoneContext } from '../../../phone/context'
import { fetchMe } from '@/web/account'
import { useAccountStatus } from './account'
import { isPhone, isWeb } from './platform'

/**
 * The signed-in account's `Me` on every platform, and a way to show a changed one. The desktop
 * reads its account status (which account.onChange keeps current), the phone its session (kept
 * current by the phone shell), and the web the `['me']` query.
 */
export function useAccountUser(): { user: Me | null; apply(me: Me): void } {
  const qc = useQueryClient()
  const phone = useContext(PhoneContext)
  const status = useAccountStatus()
  const web = isWeb() && !isPhone()
  const me = useQuery({ queryKey: ['me'], queryFn: () => fetchMe(), enabled: web })
  const apply = useCallback(
    (next: Me): void => {
      // Keep what loadMe omits (admin) from the older value.
      if (web) qc.setQueryData<Me | null>(['me'], (old) => ({ ...old, ...next }))
    },
    [web, qc]
  )
  const user = isPhone() ? (phone?.user ?? null) : web ? (me.data ?? null) : (status?.user ?? null)
  return { user, apply }
}
