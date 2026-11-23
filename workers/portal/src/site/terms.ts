import { REPO_URL } from './page'
import { MAGIC_FAN_CONTENT, SCRYFALL_CREDIT } from '../../../../src/shared/legal'
import { renderLegal, type LegalView } from './legal'

const p = (...paras: string[]): string => paras.map((t) => `<p>${t}</p>`).join('')

export function renderTerms(view: LegalView): string {
  return renderLegal(
    {
      path: '/terms',
      title: 'Terms of Service — Duel Binder',
      description: 'The terms for using Duel Binder, its apps and its web portal.',
      heading: 'Terms of Service',
      lead: 'The rules for using Duel Binder: the desktop app, the phone app and the web portal.',
      updated: 'Last updated November 22, 2026',
      sections: [
        [
          'Agreeing to these terms',
          p(
            'By using Duel Binder or signing in to it, you agree to these terms and to the <a href="/privacy">privacy policy</a>. If you don’t agree, don’t use it.'
          )
        ],
        [
          'The service',
          p(
            'Duel Binder is a free, personal project for keeping track of a Yu-Gi-Oh!, Pokémon, Magic: The Gathering or One Piece card collection. It may change, gain or lose features, or stop running, at any time and without notice.'
          )
        ],
        [
          'Affiliate links',
          p(
            'Some links to TCGplayer and eBay are affiliate links. If you buy something after following one, we may earn a commission, at no extra cost to you. Duel Binder doesn’t sell cards or see what you buy.'
          )
        ],
        [
          'Supporter subscriptions',
          p(
            'You can choose to support Duel Binder for $3 a month or $25 a year. A subscription renews until you cancel it, which you can do any time in Settings → Support Duel Binder → Manage; it then runs to the end of the period you paid for. Supporting gives a supporter badge, an optional place on the thanks page and early access to preview features. No feature is withheld from anyone who doesn’t support. Payments are handled by Stripe. Refunds are at our discretion; email support@duelbinder.com.'
          )
        ],
        [
          'Your account',
          p(
            'You sign in with an email address and password, Discord or Apple; Discord’s and Apple’s terms also apply to those sign-ins. You’re responsible for what happens while you’re signed in. You can delete your Duel Binder account at any time in Settings → Delete account.'
          )
        ],
        [
          'Your content',
          p(
            'Your collection, notes and value history stay yours. You let Duel Binder store them, sync them between your devices and show them to the friends you add, only to run the service.'
          )
        ],
        [
          'Acceptable use',
          p(
            'Don’t use Duel Binder to break the law or to harass anyone. Don’t send unwanted friend requests in bulk. Don’t try to get into other people’s accounts or data. Don’t overload, scrape or attack the portal, or get around its limits. Accounts that do any of this may be suspended or removed.'
          )
        ],
        [
          'Objectionable content',
          p(
            'There is no tolerance for objectionable content or abusive users. Names, profile pictures, photos, notes and anything else other people can see must not be offensive, sexual, hateful, violent, harassing or illegal.',
            'You can report anyone on your Friends page, or from a friend’s binder, with Report, and block them with Block. Reports go to us and are reviewed within 24 hours; content that breaks these rules is removed, and the account that posted it may be removed too. You can also email <a href="mailto:support@duelbinder.com">support@duelbinder.com</a>.'
          )
        ],
        [
          'Card data, prices and trademarks',
          p(
            'Yu-Gi-Oh! and its card names, text and art belong to Konami. Duel Binder is not affiliated with or endorsed by Konami. Card data and images come from YGOPRODeck and Yugipedia; prices come from public listings.',
            'Pokémon and its card names, text and art belong to The Pokémon Company, Nintendo, Creatures and GAME FREAK. Duel Binder is not affiliated with or endorsed by them. Pokémon card data comes from TCGdex; booster pack images from the Bulbagarden Archives and TCGplayer, and set logos from TCGdex and the Pokémon TCG API.',
            `${MAGIC_FAN_CONTENT} ${SCRYFALL_CREDIT}.`,
            'One Piece Card Game and its card names, text and art belong to Eiichiro Oda, Shueisha, Toei Animation and Bandai. Duel Binder is not affiliated with or endorsed by them.',
            'Prices and collection values are estimates and may be wrong or out of date. Don’t rely on them for buying, selling or insuring cards.'
          )
        ],
        [
          'No warranty',
          p(
            'Duel Binder is provided “as is”, without warranties of any kind. Keep your own backup of anything you can’t afford to lose: the desktop app can back up your collection from Settings.'
          )
        ],
        [
          'Limitation of liability',
          p(
            'As far as the law allows, Duel Binder and its maker aren’t liable for any indirect or consequential loss, or for lost data, arising from using it or not being able to use it.'
          )
        ],
        [
          'Changes',
          p(
            'These terms may be updated. This page will show the new date at the top, and using Duel Binder after a change means you accept the new terms.'
          )
        ],
        [
          'Contact',
          p(
            `Questions: email <a href="mailto:support@duelbinder.com">support@duelbinder.com</a>, or <a href="${REPO_URL}/issues">open an issue on GitHub</a>.`
          )
        ]
      ]
    },
    view
  )
}
