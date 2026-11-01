/**
 * Anonymous error reports, sent under the same Settings choice as the usage counts (see usage.ts).
 * Unlike those counts this is free text, so it is scrubbed where it's sent and again by the portal,
 * and a report carries only the platform, the app version, the message and the stack.
 */

import { USAGE_PLATFORMS, type UsagePlatform } from './usage'

export const MAX_ERROR_MESSAGE = 500
export const MAX_ERROR_STACK = 4000
export const MAX_ERROR_VERSION = 32
/** Reports one app run sends, whatever it hits. */
export const MAX_ERRORS_PER_SESSION = 10
/** Text past this isn't scrubbed or kept, so a huge error costs nothing. */
const MAX_SCRUB_INPUT = 20_000

/** What the app knows about an error; each bridge adds its platform. */
export interface ErrorDetails {
  appVersion: string
  message: string
  stack?: string
}

/** The body of `POST /api/errors`. */
export interface ErrorReport extends ErrorDetails {
  platform: UsagePlatform
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const SEPARATOR = String.raw`(?:[\\/]|%2f|%5c)+`
// Windows and macOS names can hold spaces, so a name runs to the next separator or line end.
const HOME_DIR = new RegExp(
  String.raw`(${SEPARATOR}(?:users|home)${SEPARATOR})[^\\/\r\n:()'"<>|?*]+`,
  'gi'
)
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi
const BEARER = /\b(bearer)\s+[a-z0-9._~+/-]+=*/gi
const SECRET_FIELD =
  /\b([a-z0-9_-]*(?:token|secret|password|passwd|api[_-]?key|session|cookie|authorization|auth)["']?\s*[:=]\s*["']?)[^\s"'&,;)]+/gi
const JWT = /\beyJ[a-z0-9_-]+\.[a-z0-9_-]+(?:\.[a-z0-9_-]+)?/gi
// Session tokens are 43 base64url characters, hashes are hex; plain long names have no digit.
const LONG_RANDOM = /[a-z0-9_-]{24,}/gi
// Discord account ids.
const SNOWFLAKE = /\b\d{17,20}\b/g

function scrubText(text: string): string {
  return text
    .slice(0, MAX_SCRUB_INPUT)
    .replace(EMAIL, '[email]')
    .replace(HOME_DIR, '$1~')
    .replace(JWT, '[token]')
    .replace(BEARER, '$1 [token]')
    .replace(SECRET_FIELD, '$1[token]')
    .replace(LONG_RANDOM, (m) => (/\d/.test(m) ? '[token]' : m))
    .replace(SNOWFLAKE, '[id]')
}

/** The report's text without home folders, emails or tokens, cut to the caps. */
export function scrubErrorDetails<T extends ErrorDetails>(report: T): T {
  const { stack, ...rest } = report
  const message = scrubText(report.message).slice(0, MAX_ERROR_MESSAGE)
  return {
    ...rest,
    message,
    ...(stack ? { stack: scrubText(stack).slice(0, MAX_ERROR_STACK) } : {})
  } as T
}

/** The report, checked; throws on an unknown platform, wrong types or text over the caps. */
export function checkErrorReport(v: unknown): ErrorReport {
  if (!isObject(v)) throw new Error('bad-report')
  const { platform, appVersion, message, stack } = v
  if (!USAGE_PLATFORMS.includes(platform as UsagePlatform)) throw new Error('bad-platform')
  if (
    typeof appVersion !== 'string' ||
    appVersion.length === 0 ||
    appVersion.length > MAX_ERROR_VERSION
  )
    throw new Error('bad-version')
  if (typeof message !== 'string' || message.length === 0 || message.length > MAX_ERROR_MESSAGE)
    throw new Error('bad-message')
  if (stack !== undefined && (typeof stack !== 'string' || stack.length > MAX_ERROR_STACK))
    throw new Error('bad-stack')
  return {
    platform: platform as UsagePlatform,
    appVersion,
    message,
    ...(stack ? { stack } : {})
  }
}

/** An uncaught value as text, with its stack when it has one; never throws. */
export function describeError(e: unknown): { message: string; stack?: string } {
  try {
    if (e instanceof Error) return { message: e.message || e.name, stack: e.stack }
    return { message: String(e) || 'Unknown error' }
  } catch {
    return { message: 'Unknown error' }
  }
}

/** Passes each distinct error once, and at most MAX_ERRORS_PER_SESSION in all. */
export function createErrorGate(): (message: string, stack?: string) => boolean {
  const seen = new Set<string>()
  return (message, stack) => {
    const key = `${message}\n${stack ?? ''}`
    if (seen.size >= MAX_ERRORS_PER_SESSION || seen.has(key)) return false
    seen.add(key)
    return true
  }
}
