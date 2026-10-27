import { useState } from 'react'

/** The safe-area insets as the page sees them, read off a probe padded by env(). */
function insets(): string {
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'
  document.body.appendChild(probe)
  const s = getComputedStyle(probe)
  const text = [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft]
    .map((v) => parseFloat(v))
    .join(' ')
  probe.remove()
  return text
}

function measure(): [string, string][] {
  const nav = navigator as Navigator & { standalone?: boolean }
  const vv = window.visualViewport
  const shell = document.querySelector('[data-phone-shell]')?.getBoundingClientRect()
  const tabs = document.querySelector('nav[aria-label="Tabs"]')?.getBoundingClientRect()
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="apple-mobile-web-app-status-bar-style"]'
  )
  return [
    ['Screen', `${screen.width}×${screen.height} @${devicePixelRatio}x`],
    ['Window', `${innerWidth}×${innerHeight} (outer ${outerWidth}×${outerHeight})`],
    ['Visual', vv ? `${Math.round(vv.width)}×${Math.round(vv.height)} top ${vv.offsetTop}` : '–'],
    ['Root', `${document.documentElement.clientWidth}×${document.documentElement.clientHeight}`],
    ['Shell', shell ? `top ${shell.top} bottom ${shell.bottom}` : '–'],
    ['Tabs', tabs ? `top ${Math.round(tabs.top)} bottom ${Math.round(tabs.bottom)}` : '–'],
    ['Insets', `${insets()} (t r b l)`],
    [
      'Mode',
      `${matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser'} · navigator.standalone ${String(nav.standalone)}`
    ],
    ['Status bar', meta?.content ?? '–'],
    ['Agent', navigator.userAgent]
  ]
}

/**
 * The screen's measurements as the page sees them, to chase iOS's home-screen sizing (WebKit bug
 * 301108) on the owner's phone. Tap to read them again.
 */
export function ScreenDetails(): React.JSX.Element {
  const [rows, setRows] = useState(measure)
  return (
    <button
      type="button"
      onClick={() => setRows(measure())}
      className="w-full rounded-2xl border border-white/[0.06] bg-card px-4 py-3 text-left font-mono text-[11px] leading-4 text-muted-foreground"
    >
      <span className="mb-1 block font-sans text-[13px] text-foreground">Screen details</span>
      {rows.map(([k, v]) => (
        <span key={k} className="block break-all">
          {k}: {v}
        </span>
      ))}
    </button>
  )
}
