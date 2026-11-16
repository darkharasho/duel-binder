import { pageShell } from './home'

/**
 * GET /supporter/thanks: where Stripe Checkout and the Customer Portal send people back. A plain
 * page; the app's Settings refetches the supporter status itself (a desktop buyer is often signed
 * out in this browser).
 */
export function supporterThanksPage(req: Request, siteUrl: string): Response {
  const q = new URL(req.url).searchParams
  const [title, text] =
    q.get('cancelled') === '1'
      ? ['Checkout cancelled', 'No charge was made. You can close this tab.']
      : q.get('managed') === '1'
        ? ['Subscription updated', 'Your changes are saved. You can close this tab.']
        : [
            'Thank you!',
            'Thank you for supporting Duel Binder! Your badge shows in the app within a minute. You can close this tab.'
          ]
  const site = new URL(siteUrl).origin
  return new Response(
    pageShell(
      siteUrl,
      `<main class="wrap"><h1>${title}</h1><p class="lead">${text}</p></main>`,
      title
    ),
    {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': `default-src 'none'; style-src 'unsafe-inline' ${site}; font-src ${site}; img-src 'self' data: ${site}; base-uri 'none'; frame-ancestors 'none'`
      }
    }
  )
}
