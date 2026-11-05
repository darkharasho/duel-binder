/** The account's sign-in methods and username rules, shared by the Worker and every client. */

export type SignInProvider = 'discord' | 'apple' | 'email'

/** One way to sign in to the account (`account:signIns`). */
export interface SignInMethod {
  provider: SignInProvider
  /** The address, for an email sign-in. */
  email?: string
  /** When it was added, as an ISO timestamp. */
  addedAt: string
}

/** Which count of a card a merge keeps: the higher, the signed-in account's, the other's, or both added. */
export type CardChoice = 'higher' | 'mine' | 'theirs' | 'sum'

/** What a merge keeps (`account:merge`): how cards combine, and whose username the account takes. */
export interface MergeChoice {
  cards: CardChoice
  username: 'mine' | 'theirs'
}

/** A username that may be chosen: 3 to 20 letters, digits, `_` and `-`. */
export const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/

/** What's wrong with this username as a choice, in words for the user; null when it's fine. */
export function usernameProblem(name: string): string | null {
  if (name.length < 3 || name.length > 20) return 'Usernames are 3 to 20 characters'
  if (!USERNAME_RE.test(name)) return 'Use letters, numbers, _ and - only'
  return null
}

/** Why the account's last sign-in can't be removed. */
export const LAST_SIGN_IN = "This is your only way to sign in, so it can't be removed"

/** One side of a merge, as the merge screen shows it. */
export interface AccountSummary {
  username: string
  /** False while the username is the generated `duelist-` one (as `Me.usernameChosen`); older portals leave it out. */
  usernameChosen?: boolean
  displayName: string | null
  avatarUrl: string | null
  /** Copies of every live card, all games. */
  cards: number
  binders: number
  wishes: number
  /** Live scan sessions; older portals leave it out. */
  sessions?: number
}

/** Both accounts, and the signed-in account's card total after merging under each choice. */
export interface MergePreview {
  mine: AccountSummary
  theirs: AccountSummary
  totals: Record<CardChoice, number>
}

/**
 * What linking a sign-in did: attached it, found it already on this account, refused because the
 * account (or the merged one) would have two of a provider, or found another account to merge,
 * with a 15-minute ticket for the merge.
 */
export type LinkResult =
  | { status: 'linked' }
  | { status: 'already' }
  | { status: 'has-provider'; provider?: SignInProvider }
  | { status: 'merge'; ticket: string; preview: MergePreview }

/** A code was mailed to the address; `ticket` goes back with the code to `account:confirmEmail`. */
export interface EmailCodeResult {
  status: 'code'
  ticket: string
}

/** What `account:addEmail` answers: a mailed code, or the link outcome when the address already has an account. */
export type AddEmailResult = EmailCodeResult | LinkResult

/** What `account:linkApple` takes: the iPhone app's Sign in with Apple result. */
export interface AppleLinkInput {
  identityToken: string
  nonce: string
  authorizationCode?: string
}
