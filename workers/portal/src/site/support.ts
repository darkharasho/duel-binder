import { esc } from './page'
import { renderLegal, type LegalView } from './legal'

const p = (...paras: string[]): string => paras.map((t) => `<p>${t}</p>`).join('')

/** duelbinder.com/support: what the supporter tier is, and the supporters who chose to be listed. */
export function renderSupport(view: LegalView & { names: string[] }): string {
  const sections: [string, string][] = [
    [
      'What it is',
      p(
        'Duel Binder is free. If you like it, you can support it for $3 a month or $25 a year.',
        'Hosting, card art and price lookups cost money every month. Supporting keeps the app free for everyone. Nothing is locked: every feature stays free, and nothing gets worse if you don’t.'
      )
    ],
    [
      'What you get',
      p(
        'A small heart beside your name, your name on this page if you want it, and early access to new features while they’re in preview.'
      )
    ],
    [
      'How to support',
      p(
        `Sign in to <a href="${esc(view.appUrl)}">Duel Binder</a> and open Settings → Support Duel Binder. Payment is handled by Stripe. You can cancel, change card or switch between monthly and yearly any time from Settings → Manage.`
      )
    ]
  ]
  if (view.names.length > 0)
    sections.push([
      'Thank you',
      `<ul class="thanks">${view.names.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
    ])
  return renderLegal(
    {
      path: '/support',
      title: 'Support Duel Binder',
      description: 'Support Duel Binder for $3 a month or $25 a year. Nothing is locked.',
      heading: 'Support Duel Binder',
      lead: 'An optional subscription that helps pay for hosting.',
      updated: '',
      sections
    },
    view
  )
}
