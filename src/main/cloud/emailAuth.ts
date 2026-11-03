import { EMAIL_COPY, type EmailAuthReply, type EmailStep } from '../../shared/emailAuth'

const OFFLINE = "Couldn't reach Duel Binder"
const EMAIL_OFF = 'email-off'

/**
 * One email sign-in step: a JSON POST to the portal. Rejects with the portal's own `error` text,
 * or "Couldn't reach Duel Binder" when it can't be reached. The reply may carry a session token,
 * so only the account service should call this.
 */
export async function emailAuthRequest(
  portalUrl: string,
  step: EmailStep,
  body: Record<string, unknown>,
  doFetch: typeof fetch = fetch
): Promise<EmailAuthReply> {
  const base = portalUrl.replace(/\/+$/, '')
  let res: Response
  try {
    res = await doFetch(`${base}/auth/email/${step}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error'
    })
  } catch {
    throw new Error(OFFLINE)
  }
  let out: unknown
  try {
    out = await res.json()
  } catch {
    out = null
  }
  if (!res.ok) {
    const message = (out as { error?: unknown } | null)?.error
    if (typeof message !== 'string' || message === EMAIL_OFF) throw new Error(EMAIL_COPY.linkFailed)
    throw new Error(message)
  }
  if (typeof (out as { next?: unknown } | null)?.next !== 'string')
    throw new Error(EMAIL_COPY.linkFailed)
  return out as EmailAuthReply
}

/** Whether the portal has email sign-in on; any failure counts as off. */
export async function emailSignInEnabled(
  portalUrl: string,
  doFetch: typeof fetch = fetch
): Promise<boolean> {
  try {
    const res = await doFetch(`${portalUrl.replace(/\/+$/, '')}/auth/email/status`)
    if (!res.ok) return false
    return ((await res.json()) as { enabled?: unknown }).enabled === true
  } catch {
    return false
  }
}
