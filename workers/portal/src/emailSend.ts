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

// The app's look: near-black with soft violet and amber glows, frosted panels with hairline
// borders. Email clients ignore stylesheets, SVG and blur, so the layout is tables with inline
// styles, the glows are radial gradients over a solid fallback, and the mark is the site's PNG.
const BG = '#111113'
const PANEL = '#18181b'
const INK = '#ecebe8'
const MUTED = '#8f8d88'
const HAIRLINE = 'rgba(255,255,255,0.08)'
const VIOLET = '#8b5cf6'
const AMBER = '#f59e0b'
const SITE = 'https://duelbinder.com'
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const GLOW =
  'radial-gradient(ellipse 75% 55% at 12% 0%,rgba(139,92,246,0.42),rgba(139,92,246,0) 75%),' +
  'radial-gradient(ellipse 60% 45% at 92% 0%,rgba(245,158,11,0.26),rgba(245,158,11,0) 75%),' +
  'radial-gradient(ellipse 55% 40% at 50% 60%,rgba(217,70,239,0.1),rgba(217,70,239,0) 75%)'

/** The frame every email shares: the app's glow behind a frosted card with the mark on top. */
export function brandedHtml(title: string, body: string, preheader: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background-color:${BG};font-family:${FONT};color:${INK}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${BG}" style="background-color:${BG};background-image:${GLOW}">
<tr><td align="center" style="padding:48px 16px 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px">
<tr><td style="padding:0 4px 20px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle"><img src="${SITE}/email-mark.png" width="37" height="40" alt="" style="display:block;border:0"></td>
<td style="vertical-align:middle;padding-left:12px;font-size:18px;font-weight:600;color:${INK};letter-spacing:-.01em">Duel Binder</td>
</tr></table>
</td></tr>
<tr><td bgcolor="${PANEL}" style="background-color:${PANEL};background-color:rgba(24,24,27,0.72);border:1px solid ${HAIRLINE};border-radius:20px;padding:0">
<div style="height:2px;line-height:2px;font-size:0;margin:0 28px;border-radius:0 0 2px 2px;background-color:${VIOLET};background-image:linear-gradient(90deg,${VIOLET},#d946ef 50%,${AMBER})">&nbsp;</div>
<div style="padding:30px 28px 28px">
<h1 style="margin:0 0 12px;font-size:21px;line-height:1.3;font-weight:600;color:${INK};letter-spacing:-.01em">${escapeHtml(title)}</h1>
${body}
</div>
</td></tr>
<tr><td style="padding:22px 8px 0;text-align:center;font-size:12px;line-height:1.6;color:${MUTED}">
Sent by Duel Binder because this address was entered in the app.<br>
<a href="${SITE}" style="color:${MUTED};text-decoration:underline">duelbinder.com</a>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`
}

const para = (s: string): string =>
  `<p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:${INK}">${s}</p>`
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
<tr><td align="center" bgcolor="#202024" style="background-color:#202024;background-color:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:20px 12px">
<span style="font-family:'SFMono-Regular',Menlo,Consolas,'Courier New',monospace;font-size:34px;font-weight:700;letter-spacing:10px;color:#ffffff">${escapeHtml(code)}</span>
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
        `The email on your Duel Binder account was changed to <strong style="color:#ffffff">${escapeHtml(newEmail)}</strong>.`
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
