import { renderLegal, type LegalView } from './legal'
import { esc } from './page'

export interface BetaView extends LegalView {
  /** The form went through: `waiting` (`?sent=1`) for the owner, or `in` (`?sent=in`), let in already. */
  sent: 'waiting' | 'in' | null
  /** The app's `?error=` code from beta.ts, when the form came back. */
  error: string | null
}

const ERRORS: Record<string, string> = {
  agree: 'Tick the box to say you understand it’s a test build.',
  platform: 'Pick Android or iPhone.',
  email: 'That email doesn’t look right. Use the one your Google Play or Apple account uses.',
  name: 'Add your name (up to 200 characters).',
  referred: 'Keep “Who sent you here?” shorter, up to 200 characters.',
  limit: 'Too many requests from this connection today. Try again tomorrow.',
  bad: 'Something went wrong sending the form. Try again.'
}

const p = (...paras: string[]): string => paras.map((t) => `<p>${t}</p>`).join('')

function form(view: BetaView): string {
  const error =
    view.error === null ? '' : (ERRORS[view.error] ?? 'Something went wrong. Try again.')
  return `${error ? `<p class="beta-error" role="alert">${esc(error)}</p>` : ''}
<form method="post" action="${esc(view.appUrl)}/beta" class="beta-form">
<fieldset><legend>Your phone</legend>
<label class="beta-choice"><input type="radio" name="platform" value="android" required> Android</label>
<label class="beta-choice"><input type="radio" name="platform" value="ios" required> iPhone</label>
</fieldset>
<label>Store email<span class="beta-hint">The email your Google Play account or Apple ID uses.</span>
<input name="email" type="email" required maxlength="200" autocomplete="email" pattern="[^\\s@]+@[^\\s@]+\\.[^\\s@]+" title="An email like name@example.com"></label>
<label>Your name<input name="name" type="text" required maxlength="200" autocomplete="name"></label>
<label>Who sent you here?<span class="beta-hint">Optional. A friend’s name helps us know you.</span>
<input name="referred" type="text" maxlength="200"></label>
<label class="beta-trap" aria-hidden="true">Website<input name="website" type="text" tabindex="-1" autocomplete="off"></label>
<label class="beta-agree"><input name="agree" type="checkbox" required> I understand these are test builds and the notes above.</label>
<button class="btn" type="submit">Ask to join</button>
</form>`
}

/** duelbinder.com/beta: the phone beta disclaimer and the form to ask to join. */
export function renderBeta(view: BetaView): string {
  const ask =
    view.sent === 'in'
      ? p(
          'You’re in. We’ve emailed you what to do next; it can take a few minutes to arrive, so check your spam folder too.'
        )
      : view.sent === 'waiting'
        ? p(
            "Thanks — you'll get an email when you're in. Testers are added by hand, so it can take a day or two."
          )
        : form(view)
  return renderLegal(
    {
      path: '/beta',
      title: 'Phone app beta — Duel Binder',
      description: 'Ask to join the Duel Binder Android or iPhone beta.',
      heading: 'Phone app beta',
      lead: 'Try the Duel Binder phone app before it’s in the stores, on Android or iPhone.',
      updated: '',
      sections: [
        [
          'Before you join',
          p(
            'These are test builds. They may crash, look rough in places or change from week to week.',
            'Your collection syncs to your Duel Binder account, so it’s safe. Scans that are not synced yet could be lost if the app breaks.',
            'Tell us what goes wrong; that’s the point of the beta. You can leave any time by uninstalling the app or leaving the test in Google Play or TestFlight.',
            'Your email is used only to invite you through Google or Apple, and to tell you when you’re in.'
          )
        ],
        ['Ask to join', ask]
      ]
    },
    view
  )
}
