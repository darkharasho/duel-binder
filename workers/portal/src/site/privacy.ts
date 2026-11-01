import { REPO_URL } from './page'
import { renderLegal, type LegalView } from './legal'

export type PrivacyView = LegalView

const p = (...paras: string[]): string => paras.map((t) => `<p>${t}</p>`).join('')

export function renderPrivacy(view: PrivacyView): string {
  return renderLegal(
    {
      path: '/privacy',
      title: 'Privacy — Duel Binder',
      description: 'What Duel Binder stores about you, why, and how to delete it.',
      heading: 'Privacy',
      lead: 'What Duel Binder keeps about you, why, and how to delete it.',
      updated: 'Last updated October 31, 2026',
      sections: [
        [
          'What is stored',
          p(
            'When you sign in with Discord, the portal stores your Discord id, username, display name and avatar. It asks Discord only for the <code>identify</code> scope: not your email, your servers or your messages. When you sign in with Apple, in the iPhone app, it stores Apple’s id for your account and, if you share it, your name; not your email.',
            'Either way it also stores your collection, wishlist, notes and value history; your friends and blocks; your sign-in sessions; and when your account last used the portal, to the hour.'
          )
        ],
        [
          'Why',
          p(
            'It keeps these to sync and show your binder: so your collection is the same on the web, on your computers and on your phone, and so friends you add can look through it. The last-used time only feeds a count of how many accounts were active in a day, week or month.'
          )
        ],
        [
          'Anonymous usage counts',
          p(
            'The apps count a short, fixed list of things, such as how often each page is opened and how many cards are added, scanned or ripped, and send only the totals every few minutes. The portal adds them to counts per day and per platform (desktop, web, phone). Nothing in them names you, your account, your device, your cards or your IP address, so they can’t be traced back to you.',
            'You can turn them off in Settings, on each device.'
          )
        ],
        [
          'Error reports',
          p(
            'The Settings choice for anonymous usage counts also covers error reports, and it is on unless you turn it off. When an app crashes or hits an error while you’re signed in, it sends the error message, its technical stack trace, the app version and the platform (desktop, web, phone).',
            'Reports aren’t linked to you. The app needs your sign-in to send one, but the portal stores only those four things and the day: not your account, your device or your IP address. To limit how many reports can be sent, it keeps a short count per account in memory, which is never stored.',
            'Unlike the usage counts, error text is free-form, so the app and the portal both remove home folder names, email addresses and tokens before it is stored. That cleaning is automatic and can’t be perfect: an unusual error could still contain something like a card name or other text from the app.',
            'Reports are deleted after 30 days. To stop them, turn off anonymous usage counts and error reports in Settings, on each device; that stops both together.'
          )
        ],
        [
          'Who else handles it',
          p(
            'The portal runs on Cloudflare, which stores its data and keeps request logs, which can include IP addresses, for a few days for troubleshooting. Discord and Apple handle signing in. Nothing is shared with anyone else.'
          )
        ],
        [
          'What is not done with it',
          p(
            'Nothing is sold or used for ads.',
            'There are no third-party trackers.',
            'When you scan cards, the camera picture is processed on your phone and never uploaded.',
            'Card images come through the portal, in every app and on the web, so the sites that host them don’t see you. Two things load from elsewhere: Discord avatars, yours and your friends’, come straight from Discord, and the desktop app checks GitHub for updates.'
          )
        ],
        [
          'How long it is kept',
          p(
            'Your account data is kept until you delete your account. Sign-in sessions expire on their own, and signing out ends them. The anonymous daily counts are kept, since they belong to no one. Error reports are deleted after 30 days.'
          )
        ],
        [
          'Deleting your account',
          p(
            'Go to Settings → Delete account, on the web or in the phone app. This removes your synced collection, wishlist, friends and sign-ins on every device. Desktop apps keep their own copy on that computer and are signed out.'
          )
        ],
        [
          'Children',
          p(
            'Duel Binder isn’t meant for children under 13, and an account needs Discord or Apple, which set their own minimum ages.'
          )
        ],
        [
          'Changes',
          p('If this policy changes, this page will say so and show the new date at the top.')
        ],
        [
          'Contact',
          p(
            `Questions or requests, including about your data: email <a href="mailto:support@duelbinder.com">support@duelbinder.com</a>, or <a href="${REPO_URL}/issues">open an issue on GitHub</a>.`
          )
        ]
      ]
    },
    view
  )
}
