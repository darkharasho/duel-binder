import { describe, expect, it } from 'vitest'
import { handleSite } from '../../workers/portal/src/site/handler'
import { footer } from '../../workers/portal/src/site/page'
import { renderTerms } from '../../workers/portal/src/site/terms'
import { renderPrivacy } from '../../workers/portal/src/site/privacy'
import { supporterThanksPage } from '../../workers/portal/src/supporterThanks'

const APP = 'https://app.duelbinder.com'
const site = (names: () => Promise<string[]>) => ({
  appUrl: APP,
  assets: { fetch: async () => new Response('asset') },
  downloads: async () => ({ version: null, windows: null, mac: null, linux: null, android: null }),
  supporterNames: names
})
const page = async (names: () => Promise<string[]>): Promise<string> =>
  (await handleSite(new Request('https://duelbinder.com/support'), site(names))).text()

describe('support pages', () => {
  it('links Support from the footer', () => {
    expect(footer()).toContain('<a href="/support">Support</a>')
  })

  it('explains the tier and lists supporters, escaped', async () => {
    const html = await page(async () => ['Ann', '<b>Bo</b>'])
    expect(html).toContain('$3 a month or $25 a year')
    expect(html).toContain('Nothing is locked')
    expect(html).toContain('Settings → Support Duel Binder')
    expect(html).toContain(`href="${APP}"`)
    expect(html).toContain('<li>Ann</li>')
    expect(html).toContain('<li>&lt;b&gt;Bo&lt;/b&gt;</li>')
  })

  it('still renders without names or when they fail to load', async () => {
    expect(await page(async () => [])).not.toContain('<ul class="thanks">')
    const html = await page(async () => {
      throw new Error('down')
    })
    expect(html).toContain('Support Duel Binder')
    expect(html).not.toContain('<ul class="thanks">')
  })

  it('thanks the buyer, or says nothing was charged, or that changes are saved', async () => {
    const text = (q: string): Promise<string> =>
      supporterThanksPage(new Request(`${APP}/supporter/thanks${q}`), 'https://duelbinder.com').text()
    expect(await text('')).toContain('Thank you for supporting Duel Binder!')
    expect(await text('?cancelled=1')).toContain('No charge was made.')
    expect(await text('?managed=1')).toContain('Your changes are saved.')
  })

  it('covers subscriptions in the terms and Stripe in the privacy policy', () => {
    const terms = renderTerms({ appUrl: APP })
    expect(terms).toContain('Supporter subscriptions')
    expect(terms).toContain('renews until you cancel')
    expect(renderPrivacy({ appUrl: APP })).toContain('Stripe')
  })
})
