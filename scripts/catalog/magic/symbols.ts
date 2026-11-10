import { Resvg } from '@resvg/resvg-js'
import type Database from 'better-sqlite3'
import { MAX_SYMBOL_PNG_BYTES } from '../../../src/shared/imageSources'

/**
 * Magic set symbols for the nightly job. Scryfall draws each symbol as a single-colour (black) SVG.
 * The portal never serves SVG (it can carry script), so the job turns each one into a white PNG
 * here, with resvg (a devDependency: never in the app or the Worker), and hands the PNG to the
 * portal, which checks it is a PNG and keeps it in R2 under the symbol's set key ('ms-…', see
 * mtgSymbolKey). /img/set/<key> then serves it from R2 only.
 *
 * Only symbols R2 doesn't hold yet are fetched and uploaded: all of them the first night, a new or
 * redrawn one (a new key) after that. A symbol that fails is only noted, and tried again next night.
 */

/** Height of the PNG in pixels; the width follows the symbol's own shape. */
export const SYMBOL_HEIGHT = 256
/** Keys per "which are missing" request (the portal takes at most 100). */
const CHECK_BATCH = 100
/** Failure lines kept in the report; the rest are counted. */
const MAX_NOTES = 20
const FILTER_ID = 'duel-binder-white'

/**
 * The symbol as a PNG `height` pixels tall, every drawn pixel white and its coverage kept as alpha
 * (a filter floods white through the drawing's own alpha, whatever colours the SVG uses).
 */
export function whiteSymbolPng(svg: string, height = SYMBOL_HEIGHT): Uint8Array {
  const open = /<svg\b[^>]*>/i.exec(svg)
  const close = svg.toLowerCase().lastIndexOf('</svg>')
  if (!open || open[0].endsWith('/>') || close < open.index + open[0].length)
    throw new Error('not an SVG document')
  const start = open.index + open[0].length
  const wrapped =
    svg.slice(0, start) +
    `<defs><filter id="${FILTER_ID}"><feFlood flood-color="#fff"/><feComposite in2="SourceAlpha" operator="in"/></filter></defs>` +
    `<g filter="url(#${FILTER_ID})">` +
    svg.slice(start, close) +
    '</g>' +
    svg.slice(close)
  const png = new Resvg(wrapped, {
    fitTo: { mode: 'height', value: height },
    font: { loadSystemFonts: false }
  })
    .render()
    .asPng()
  return new Uint8Array(png)
}

export interface SymbolReport {
  /** Distinct symbol keys tonight's Magic sets show. */
  inUse: number
  /** Already in the portal's R2. */
  stored: number
  uploaded: number
  failed: number
  notes: string[]
}

export interface SyncSymbolsOpts {
  portal: { url: string; token: string; fetch?: typeof fetch }
  /** A symbol's SVG text (the Scryfall source's symbolSvg). */
  svg: (url: string) => Promise<string>
  /** Replaces whiteSymbolPng (tests). */
  rasterize?: (svg: string) => Uint8Array
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Uploads the symbols of the work database's Magic sets that the portal lacks. Never rejects. */
export async function syncMagicSymbols(
  work: Database.Database,
  o: SyncSymbolsOpts
): Promise<SymbolReport> {
  const report: SymbolReport = { inUse: 0, stored: 0, uploaded: 0, failed: 0, notes: [] }
  const failed = (line: string): void => {
    report.failed++
    if (report.notes.length < MAX_NOTES) report.notes.push(line)
  }
  const fetchFn = o.portal.fetch ?? fetch
  const base = o.portal.url.replace(/\/+$/, '')
  const auth = { authorization: `Bearer ${o.portal.token}` }
  const rasterize = o.rasterize ?? ((svg: string) => whiteSymbolPng(svg))

  let symbols: { key: string; url: string }[]
  try {
    symbols = work
      .prepare(
        `SELECT image_key AS key, MIN(image_url) AS url FROM sets
         WHERE game = 'mtg' AND image_key LIKE 'ms-%' AND image_url IS NOT NULL
         GROUP BY image_key ORDER BY image_key`
      )
      .all() as { key: string; url: string }[]
  } catch (e) {
    failed(`symbols not read: ${message(e)}`)
    return report
  }
  report.inUse = symbols.length

  const missing: { key: string; url: string }[] = []
  for (let i = 0; i < symbols.length; i += CHECK_BATCH) {
    const batch = symbols.slice(i, i + CHECK_BATCH)
    try {
      const res = await fetchFn(`${base}/admin/img/set-symbols/missing`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ keys: batch.map((s) => s.key) }),
        signal: AbortSignal.timeout(60_000)
      })
      if (!res.ok) throw new Error(`portal returned ${res.status}`)
      const body = (await res.json()) as { missing?: unknown }
      if (!Array.isArray(body.missing)) throw new Error('portal sent no missing list')
      const lacking = new Set(body.missing)
      for (const s of batch) {
        if (lacking.has(s.key)) missing.push(s)
        else report.stored++
      }
    } catch (e) {
      // Unknown whether R2 holds them: count them failed, and next night asks again.
      for (const s of batch) failed(`${s.key}: not checked (${message(e)})`)
    }
  }

  for (const s of missing) {
    try {
      const png = rasterize(await o.svg(s.url))
      if (png.byteLength > MAX_SYMBOL_PNG_BYTES)
        throw new Error(`PNG is ${png.byteLength} bytes, over ${MAX_SYMBOL_PNG_BYTES}`)
      const res = await fetchFn(`${base}/admin/img/set-symbols/${s.key}`, {
        method: 'PUT',
        headers: { ...auth, 'content-type': 'image/png' },
        body: new Uint8Array(png), // a copy on its own ArrayBuffer, as fetch wants
        signal: AbortSignal.timeout(60_000)
      })
      if (!res.ok) throw new Error(`portal returned ${res.status}`)
      report.uploaded++
    } catch (e) {
      failed(`${s.key}: ${message(e)}`)
    }
  }
  return report
}
