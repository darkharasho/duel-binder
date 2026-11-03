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

// The logo's colours (resources/brand/small.svg). Email clients ignore stylesheets and SVG, so the
// layout is tables with inline styles and the mark is the site's PNG icon.
const NAVY = '#141e33'
const CREAM = '#fbf4e5'
const RED = '#e2412c'
const INK = '#1f2433'
const MUTED = '#6b6f7b'
const SITE = 'https://duelbinder.com'
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

/** The branded frame every email shares: the mark on navy, a white card, a quiet footer. */
export function brandedHtml(title: string, body: string, preheader: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#eef0f4;font-family:${FONT};color:${INK}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0f4">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px">
<tr><td style="background:${NAVY};border-radius:14px 14px 0 0;padding:20px 28px;border-bottom:3px solid ${RED}">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle"><img src="${SITE}/apple-touch-icon.png" width="36" height="36" alt="" style="display:block;border:0;border-radius:9px"></td>
<td style="vertical-align:middle;padding-left:12px;font-size:17px;font-weight:600;color:${CREAM};letter-spacing:-.01em">Duel Binder</td>
</tr></table>
</td></tr>
<tr><td style="background:#ffffff;border-radius:0 0 14px 14px;padding:32px 28px 28px">
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;font-weight:600;color:${INK}">${escapeHtml(title)}</h1>
${body}
</td></tr>
<tr><td style="padding:20px 8px 0;text-align:center;font-size:12px;line-height:1.6;color:${MUTED}">
Sent by Duel Binder because this address was entered in the app.<br>
<a href="${SITE}" style="color:${MUTED};text-decoration:underline">duelbinder.com</a>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`
}

const para = (s: string): string =>
  `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${INK}">${s}</p>`
const small = (s: string): string =>
  `<p style="margin:0;font-size:13px;line-height:1.6;color:${MUTED}">${s}</p>`

const TITLE: Record<Purpose, string> = {
  signup: 'Finish creating your account',
  reset: 'Reset your password',
  add: 'Add this email to your account',
  change: 'Confirm your new email'
}

export function codeMessage(to: string, code: string, purpose: Purpose): EmailMessage {
  const intro = INTRO[purpose]
  const note = "It expires in 15 minutes. If you didn't ask for it, you can ignore this email."
  const box = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px">
<tr><td align="center" style="background:${CREAM};border-radius:10px;padding:18px 12px">
<span style="font-family:'SFMono-Regular',Menlo,Consolas,'Courier New',monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:${NAVY}">${escapeHtml(code)}</span>
</td></tr></table>`
  return {
    to,
    subject: `Your Duel Binder code: ${code}`,
    text: `${intro}\n\n${code}\n\n${note}\n`,
    html: brandedHtml(TITLE[purpose], para(intro) + box + small(note), `Your code is ${code}`)
  }
}

/** Sent to the old address when an account's email changes. */
export function changedNotice(to: string, newEmail: string): EmailMessage {
  const body = `The email on your Duel Binder account was changed to ${newEmail}. If this wasn't you, sign in with another method and review your account.`
  return {
    to,
    subject: 'Your Duel Binder sign-in email was changed',
    text: `${body}\n`,
    html: brandedHtml(
      'Your sign-in email was changed',
      para(
        `The email on your Duel Binder account was changed to <strong>${escapeHtml(newEmail)}</strong>.`
      ) + small("If this wasn't you, sign in with another method and review your account."),
      `Your sign-in email was changed to ${newEmail}`
    )
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
