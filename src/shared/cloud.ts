/** Limits shared by the desktop sync client and the server's sync endpoints. */

/** Most entries one push may send. */
export const MAX_PUSH = 500
/** Most entries one pull returns. */
export const MAX_PULL = 1000
/** Longest notes an entry may hold, on desktop and server alike. */
export const MAX_NOTES = 2000
/** How far in the future a client timestamp may be before the server rejects it. */
export const FUTURE_SKEW_MS = 600_000
