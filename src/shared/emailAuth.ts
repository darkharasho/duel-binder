import type { SignInProvider } from './account'
import type { Me } from './cloud'

export const MAX_EMAIL_LEN = 254
export const MIN_PASSWORD = 8
export const MAX_PASSWORD = 128

/** Visible hint in a password box; a new password also says the minimum length. */
export function passwordPlaceholder(label: string, autoComplete: string): string {
  return autoComplete === 'new-password' ? `${label} (at least ${MIN_PASSWORD} characters)` : label
}
export const CODE_LENGTH = 6

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const PROVIDER_LABEL: Record<SignInProvider, string> = {
  discord: 'Discord',
  apple: 'Apple',
  email: 'Email'
}
const label = (p: string): string => PROVIDER_LABEL[p as SignInProvider] ?? p

/** Trim and lowercase; nothing else is rewritten. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

export function emailProblem(email: string): string | null {
  return email.length <= MAX_EMAIL_LEN && EMAIL_SHAPE.test(email)
    ? null
    : 'Enter a valid email address'
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Passwords are at least ${MIN_PASSWORD} characters`
  if (pw.length > MAX_PASSWORD) return `Passwords are at most ${MAX_PASSWORD} characters`
  return null
}

export const EMAIL_COPY = {
  wrongPassword: "That password doesn't match.",
  tooManyCodes: 'Too many codes. Try again in a few minutes.',
  tooManyTries: 'Too many tries. Wait a few minutes or reset your password.',
  sendFailed: "We couldn't send the code. Try again.",
  emailTaken: 'That email is already used by another account.',
  codeWrong: "That code doesn't match.",
  codeExpired: 'That code has expired. Send a new one.',
  noAccount: 'No account uses this email.',
  linkFailed: "We couldn't confirm that sign-in. Try again.",
  oneBox: "We'll sign you in, or make a new account if this email is new.",
  matchProvider: (p: string): string =>
    `There's already a Duel Binder account using this email. It signs in with ${label(p)}. Link your email to it?`,
  matchClaim: (p: string): string =>
    `There's already a Duel Binder account using this email. Link ${label(p)} to it?`,
  alsoHas: (p: string): string =>
    `That account also has ${label(p)}. Sign in to it and remove one first.`,
  linkOnIphone: 'You can link them later from the Duel Binder iPhone app.',
  mergeOnPhone: 'That email belongs to another account. Link it from the Duel Binder phone app.',
  otherAccount: (p: string): string => `That ${label(p)} account isn't the one using this email.`
}

export type EmailStep =
  | 'check'
  | 'password'
  | 'create'
  | 'confirm'
  | 'resend'
  | 'forgot'
  | 'reset'
  | 'separate'
  | 'link-discord'
  | 'link-apple'
  | 'claim'
  | 'claim-separate'

export type EmailAuthReply =
  | { next: 'password' | 'create'; email: string }
  | { next: 'code'; ticket: string; email: string; purpose: 'signup' | 'reset' }
  | { next: 'new-password'; ticket: string }
  | { next: 'match'; ticket: string; email: string; providers: SignInProvider[] }
  | { next: 'signed-in'; token: string; user: Me; created: boolean }

/** What renderers see: the session token never reaches them. */
export type EmailAuthView =
  Exclude<EmailAuthReply, { next: 'signed-in' }> | { next: 'signed-in'; user: Me; created: boolean }
