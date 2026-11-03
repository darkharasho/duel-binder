/** The account's sign-in methods and username rules, shared by the Worker and every client. */

export type SignInProvider = 'discord' | 'apple'

/** One way to sign in to the account (`account:signIns`). */
export interface SignInMethod {
  provider: SignInProvider
  /** When it was added, as an ISO timestamp. */
  addedAt: string
}

/** Which count of a card a merge keeps: the higher, the signed-in account's, the other's, or both added. */
export type CardChoice = 'higher' | 'mine' | 'theirs' | 'sum'

/** A username that may be chosen: 3 to 20 letters, digits, `_` and `-`. */
export const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/

/** What's wrong with this username as a choice, in words for the user; null when it's fine. */
export function usernameProblem(name: string): string | null {
  if (name.length < 3 || name.length > 20) return 'Usernames are 3 to 20 characters'
  if (!USERNAME_RE.test(name)) return 'Use letters, numbers, _ and - only'
  return null
}
