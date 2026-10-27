import { clearSavedScans } from '@/features/scan/session'

/** The id of the user whose unsaved scans the phone keeps (see useScanSession's saved list). */
const OWNER_KEY = 'scan.session.owner'

/**
 * Called as a signed-in user enters the app, before the scanner mounts. The unsaved scans are the
 * user's who made them: the same user keeps them across a sign-out, another user starts with none
 * (so they can't add someone else's scans to their own collection).
 */
export function claimSavedScans(userId: number): void {
  try {
    const owner = localStorage.getItem(OWNER_KEY)
    if (owner !== null && owner !== String(userId)) clearSavedScans()
    localStorage.setItem(OWNER_KEY, String(userId))
  } catch {
    // Unavailable storage holds no list.
  }
}

/** The account is deleted: its unsaved scans go too. */
export function forgetSavedScans(): void {
  clearSavedScans()
  try {
    localStorage.removeItem(OWNER_KEY)
  } catch {
    // As above.
  }
}
