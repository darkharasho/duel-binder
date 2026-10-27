/** The phone app's fixed copy (see the plan's Global Constraints). */

export const UNSUPPORTED =
  "This browser can't run Duel Binder. On iPhone, update to iOS 17 or later; otherwise use Chrome or Safari."

export const OPEN_ELSEWHERE = 'Duel Binder is open in another tab. Close it and try again.'

export const SIGN_IN_COPY = 'Sign in with Discord to scan cards into your collection.'
export const SIGN_IN_FAILED = "Sign-in didn't go through. Try again."
export const SIGN_IN_URL = '/auth/discord/start?next=scan'

export const FIRST_RUN_TITLE = 'Downloading card data'
export const FIRST_RUN_SIZE = 'About 15 MB. Use Wi-Fi if you can.'
export const FIRST_RUN_CELLULAR = "You're on mobile data. This download is about 15 MB."
export const FIRST_RUN_STOPPED = 'Download stopped. It will pick up where it left off.'

export const STORAGE_WARNING =
  "Your browser may clear this app's data. Sync before closing it for long."

export const PRIVACY_URL = 'https://duelbinder.com/privacy'

/** "Card data from Oct 27", from the catalog's last update; null before the first. */
export function cardDataAge(lastSyncAt: string | null): string | null {
  if (!lastSyncAt) return null
  const d = new Date(lastSyncAt)
  if (Number.isNaN(d.getTime())) return null
  return `Card data from ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

/** The sign-out warning when adds haven't synced yet. */
export function signOutWarning(waiting: number, name: string): string {
  return waiting === 1
    ? `1 card hasn't synced yet. It'll sync if you sign back in as ${name}.`
    : `${waiting} cards haven't synced yet. They'll sync if you sign back in as ${name}.`
}
