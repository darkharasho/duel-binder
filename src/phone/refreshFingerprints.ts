import type { FingerprintStatus } from '@shared/scan/types'
import { api } from '@/lib/api'
import type { PhoneStore } from './data/store'

/**
 * Refreshes the fingerprint file of every game the account can use. The status is the worst one:
 * an error in any game's file shows as an error.
 */
export async function refreshAllFingerprints(
  store: PhoneStore,
  opts: { force?: boolean } = {}
): Promise<FingerprintStatus> {
  const games = await api.games.available().catch(() => ['ygo' as const])
  const statuses = await Promise.all(
    games.map((game) => store.refreshFingerprints({ game, ...opts }))
  )
  return statuses.find((s) => s.state === 'error') ?? statuses[0]
}
