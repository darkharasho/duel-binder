import { renderLegal, type LegalView } from './legal'
import { esc } from './page'

export interface WaitlistView extends LegalView {
  /** The form went through (`?sent=1`). */
  sent: boolean
  /** Seats were open with no one waiting, so nobody joined (`?open=1`). */
  open: boolean
  /** The app's `?error=` code from seatPages.ts, when the form came back. */
  error: string | null
}

const ERRORS: Record<string, string> = {
  email: 'That email doesn’t look right. Check it and try again.',
  limit: 'Too many requests from this connection today. Try again tomorrow.',
  bad: 'Something went wrong sending the form. Try again.'
}

function form(view: WaitlistView): string {
  const error =
    view.error === null ? '' : (ERRORS[view.error] ?? 'Something went wrong. Try again.')
  return `${error ? `<p class="beta-error" role="alert">${esc(error)}</p>` : ''}
<form method="post" action="${esc(view.appUrl)}/waitlist" class="beta-form">
<label>Email<span class="beta-hint">We’ll email you an invite link when a seat opens.</span>
<input name="email" type="email" required maxlength="200" autocomplete="email" pattern="[^\\s@]+@[^\\s@]+\\.[^\\s@]+" title="An email like name@example.com"></label>
<label class="beta-trap" aria-hidden="true">Website<input name="website" type="text" tabindex="-1" autocomplete="off"></label>
<button class="btn" type="submit">Join the waitlist</button>
</form>`
}

/** duelbinder.com/waitlist: the form to join the waitlist while Duel Binder is full. */
export function renderWaitlist(view: WaitlistView): string {
  const ask = view.open
    ? `<p>Seats are open right now, so there’s no need to wait.</p>
<p><a class="btn" href="${esc(view.appUrl)}/">Sign up</a></p>`
    : view.sent
      ? '<p>You’re on the list. We’ll email you an invite link when a seat opens.</p>'
      : form(view)
  return renderLegal(
    {
      path: '/waitlist',
      title: 'Waitlist — Duel Binder',
      description: 'Join the Duel Binder waitlist.',
      heading: 'Waitlist',
      lead: 'Duel Binder is full for now. Join the waitlist and we’ll email you when a seat opens.',
      updated: '',
      sections: [['Join the waitlist', ask]]
    },
    view
  )
}
