import type { AppDeps } from './app'

export interface EmailMessage {
  to: string
  subject: string
  text: string
  html: string
}

export interface EmailSender {
  send(m: EmailMessage): Promise<void>
}

type Purpose = 'signup' | 'reset' | 'add' | 'change'

const INTRO: Record<Purpose, string> = {
  signup: 'Use this code to finish creating your Duel Binder account.',
  reset: 'Use this code to reset your Duel Binder password.',
  add: 'Use this code to add this email to your Duel Binder account.',
  change: 'Use this code to confirm your new Duel Binder email.'
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function codeMessage(to: string, code: string, purpose: Purpose): EmailMessage {
  const intro = INTRO[purpose]
  const note = "It expires in 15 minutes. If you didn't ask for it, you can ignore this email."
  return {
    to,
    subject: `Your Duel Binder code: ${code}`,
    text: `${intro}\n\n${code}\n\n${note}\n`,
    html: `<p>${intro}</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${escapeHtml(code)}</p><p>${note}</p>`
  }
}

/** Sent to the old address when an account's email changes. */
export function changedNotice(to: string, newEmail: string): EmailMessage {
  const body = `The email on your Duel Binder account was changed to ${newEmail}. If this wasn't you, sign in with another method and review your account.`
  return {
    to,
    subject: 'Your Duel Binder sign-in email was changed',
    text: `${body}\n`,
    html: `<p>${escapeHtml(body)}</p>`
  }
}

/** The part of Cloudflare's `SendEmail` binding used here (the root tsconfig has no workers-types). */
export interface SendEmailBinding {
  send(m: {
    to: string
    from: { email: string; name: string }
    subject: string
    html: string
    text: string
  }): Promise<unknown>
}

export function bindingSender(binding: SendEmailBinding): EmailSender {
  return {
    async send(m) {
      await binding.send({
        to: m.to,
        from: { email: 'no-reply@duelbinder.com', name: 'Duel Binder' },
        subject: m.subject,
        text: m.text,
        html: m.html
      })
    }
  }
}

export function emailEnabled(deps: AppDeps): boolean {
  return deps.env.EMAIL_SIGN_IN === 'on' && deps.email !== undefined
}
