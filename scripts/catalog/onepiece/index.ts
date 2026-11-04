import type Database from 'better-sqlite3'
import { createLimiter } from '../pokemon/http'
import type { TcPrice } from '../pokemon/types'
import { isFrozen, refreshArt, type ArtBatch, type ArtPortal } from './art'
import { openOpCache, type OpCache } from './cache'
import { donCards } from './don'
import { matchSeries, type OpMatch } from './match'
import { createOnePieceSources, dedupeEntries, readPackShots, type OnePieceSources } from './sources'
import type { OpProduct } from './tcgcsv'
import type { BandaiEntry, BandaiSeries } from './types'
import { mapGroups, productVersion } from './versions'
import { writeOnePiece, type OnePieceReport as WrittenReport } from './write'

export interface OnePieceReport extends WrittenReport {
  /** Live TCGplayer products no Bandai entry took (event stamps, pre-release cards, ...). */
  tcgOnly: number
  /** DON!! products not written tonight: no picture yet, or no price row to tell their finish. */
  donHeld: number
}

export interface OnePieceStepOpts {
  /** The job-local source cache (catalog-work/onepiece-src.sqlite). */
  cachePath: string
  version: string
  log: (l: string) => void
  /** Where art is uploaded; absent on a dry run. */
  portal?: ArtPortal
  /** Replaces the live sources (tests). */
  sources?: OnePieceSources
  now?: () => Date
  /** Art downloads tonight; defaults to ART_BUDGET. */
  budget?: number
}

export interface OnePieceStepResult {
  report: OnePieceReport | null
  error: string | null
  problems: string[]
}

/** A set this size or larger whose priced share falls this much since last night, with fewer priced, is a problem. */
const SHARE_SET_MIN = 20
/** 20 points: a fifth. */
const SHARE_DROP_PARTS = 5

const seriesOrder = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true })

/** TCGCSV's `publishedOn` (`2026-08-28T00:00:00`, no zone) read as UTC; null when unreadable. */
function publishedMs(s: string | undefined): number | null {
  if (!s) return null
  const t = Date.parse(/(Z|[+-]\d\d:\d\d)$/i.test(s) ? s : `${s}Z`)
  return Number.isNaN(t) ? null : t
}

const isPool = (s: BandaiSeries): boolean => s.kind === 'promo' || s.kind === 'other'
const percent = (priced: number, printings: number): number =>
  Math.round((priced / printings) * 100)

/**
 * The nightly job's One Piece step: Bandai's English card list, matched to TCGplayer's products by
 * art and priced from TCGCSV. Any throw (a source down, an id collision) is returned as `error`, and
 * the work database keeps last night's op rows, since writeOnePiece writes in one transaction at the
 * end. Art already hashed or uploaded tonight stays in the source cache either way.
 */
export async function runOnePieceStep(
  work: Database.Database,
  o: OnePieceStepOpts
): Promise<OnePieceStepResult> {
  const problems: string[] = []
  let opened: OpCache | undefined
  try {
    // Inside the try: a corrupt or locked cache file is tonight's error, not a failed job.
    const cache = (opened = openOpCache(o.cachePath))
    const sources = o.sources ?? createOnePieceSources({ cache, version: o.version, log: o.log })
    const date = o.now?.() ?? new Date()
    const now = date.getTime()
    const notes: string[] = []

    // 1. Fetch.
    const listed = await sources.series()
    notes.push(...listed.notes)
    const series = listed.series
    const packs = await readPackShots(sources, series)
    notes.push(...packs.notes)
    const groups = await sources.groups()
    const { bySeries, promoPool } = mapGroups(series, groups)
    const published = new Map<string, number>()
    for (const [id, g] of bySeries) {
      const t = publishedMs(g.publishedOn)
      if (t !== null) published.set(id, t)
    }
    const fetched = await sources.entries(series, published)
    problems.push(...fetched.problems)
    notes.push(...fetched.notes)
    const deduped = dedupeEntries(series, fetched.entries, published)
    notes.push(...deduped.notes)
    const entries = deduped.entries

    const limit = createLimiter(4)
    const groupIds = [...new Set([...bySeries.values(), ...promoPool].map((g) => g.groupId))]
    const products = new Map<number, OpProduct[]>()
    const groupPrices = new Map<number, TcPrice[]>()
    /** Group id to its first error tonight. */
    const failed = new Map<number, string>()
    const attempt = (id: number, fn: () => Promise<void>): Promise<void> =>
      limit(async () => {
        try {
          await fn()
        } catch (e) {
          if (!failed.has(id)) failed.set(id, e instanceof Error ? e.message : String(e))
        }
      })
    await Promise.all(
      groupIds.flatMap((id) => [
        attempt(id, async () => {
          products.set(id, await sources.products(id))
        }),
        attempt(id, async () => {
          groupPrices.set(id, await sources.prices(id))
        })
      ])
    )
    if (groupIds.length > 0 && failed.size === groupIds.length) {
      throw new Error(`every TCGCSV group failed (${groupIds.length}); first: ${failed.values().next().value}`)
    }
    // A failed group sits tonight out: its series aren't matched, so their printings keep last
    // night's products and prices. Raised the first night of a run of failures, noted after.
    const failingSince = cache.failingGroups()
    const failing = new Map<number, number>()
    const groupName = new Map(groups.map((g) => [g.groupId, g.name]))
    for (const [id, err] of failed) {
      products.delete(id)
      groupPrices.delete(id)
      const since = failingSince.get(id)
      failing.set(id, since ?? now)
      const line = `TCGCSV group ${id} (${groupName.get(id) ?? '?'}) failed: ${err}; its printings keep their products and prices`
      if (since === undefined) problems.push(line)
      else notes.push(`${line} (failing since ${new Date(since).toISOString().slice(0, 10)})`)
    }
    cache.setFailingGroups(failing)
    const priceRows: TcPrice[] = [...groupPrices.values()].flat()
    const poolFailed = promoPool.some((g) => failed.has(g.groupId))
    /** True when a group this series' products come from failed tonight. */
    const sitsOut = (s: BandaiSeries): boolean => {
      if (isPool(s)) return poolFailed
      const g = bySeries.get(s.id)
      return !!g && failed.has(g.groupId)
    }
    const poolProducts = promoPool.flatMap((g) => products.get(g.groupId) ?? [])
    /** A series' candidates: its mapped group's products, or the promo pool's; none while it sits out. */
    const productsOf = (s: BandaiSeries): OpProduct[] => {
      if (sitsOut(s)) return []
      if (isPool(s)) return poolProducts
      const g = bySeries.get(s.id)
      return g ? (products.get(g.groupId) ?? []) : []
    }
    const entriesOf = new Map<string, BandaiEntry[]>()
    for (const e of entries) {
      const l = entriesOf.get(e.seriesId)
      if (l) l.push(e)
      else entriesOf.set(e.seriesId, [e])
    }

    // 2. The stored state.
    const stored = new Map(
      (
        work
          .prepare(
            "SELECT set_rarity_code, tcg_product_id FROM card_printings WHERE game = 'op' AND tcg_product_id IS NOT NULL"
          )
          .all() as { set_rarity_code: string; tcg_product_id: number }[]
      ).map((r) => [r.set_rarity_code, r.tcg_product_id])
    )
    const firstSeen = cache.firstSeenAll()
    const rowsOf = new Map<number, number>()
    for (const p of priceRows) rowsOf.set(p.productId, (rowsOf.get(p.productId) ?? 0) + 1)
    // Exactly one row is a price; several are left unpriced (Builder's call 6).
    const prices = new Map<number, number | null>()
    for (const p of priceRows)
      prices.set(p.productId, rowsOf.get(p.productId) === 1 ? p.marketPrice : null)

    // 3. Art, newest series first; unmapped series (the promo pages among them) last.
    const order = [...series].sort((a, b) => {
      const pa = published.get(a.id)
      const pb = published.get(b.id)
      if (pa !== pb) return pa === undefined ? 1 : pb === undefined ? -1 : pb - pa
      return seriesOrder(a.id, b.id)
    })
    const batches: ArtBatch[] = order.map((s) => ({
      seriesId: s.id,
      entries: entriesOf.get(s.id) ?? [],
      candidates: productsOf(s)
    }))
    const art = await refreshArt({
      cache,
      sources,
      batches,
      stored,
      portal: o.portal,
      now,
      log: o.log,
      budget: o.budget
    })
    for (const id of art.firstNoticed) problems.push(`Bandai art changed: ${id}`)
    for (const id of art.tooLarge)
      notes.push(`${id}: Bandai art is too large for the portal; not downloaded again until its re-check`)

    // 4. The art state.
    const hashed = new Set<string>()
    const frozen = new Set<string>()
    for (const e of entries) {
      if (!cache.getBandaiArt(e.bandaiId)) continue
      hashed.add(e.bandaiId)
      if (isFrozen(cache, e.bandaiId)) frozen.add(e.bandaiId)
    }
    const firstNoticed = new Set(art.firstNoticed)
    for (const id of frozen) {
      if (!firstNoticed.has(id))
        notes.push(`${id}: Bandai art changed; frozen until its bandai_art row is cleared`)
    }

    // 5. Matching.
    const matches = new Map<string, OpMatch>()
    const bandaiHash = (id: string): string | null => cache.getBandaiArt(id)?.hash ?? null
    const tcgHash = (p: OpProduct): string | null => {
      if (p.imageUrl === null) return null
      const row = cache.getTcgArt(p.productId)
      // A hash of an older picture says nothing about the product's current one.
      return row && row.imageUrl === p.imageUrl ? row.hash : null
    }
    for (const s of order) {
      const own = entriesOf.get(s.id)
      if (!own || sitsOut(s)) continue
      const r = matchSeries({
        series: s,
        entries: own,
        products: productsOf(s),
        bandaiHash,
        tcgHash,
        stored
      })
      notes.push(...r.notes)
      for (const [id, m] of r.matches) matches.set(id, m)
    }
    // The promotion and other-product pages share the pool: one product never prices two entries.
    const takers = new Map<number, string[]>()
    for (const m of matches.values())
      takers.set(m.product.productId, [...(takers.get(m.product.productId) ?? []), m.bandaiId])
    for (const [pid, ids] of takers) {
      if (ids.length < 2) continue
      // A printing already on the product keeps it (Builder's call 5); the newcomers don't take it.
      const keeper = ids.find((id) => stored.get(id) === pid)
      const dropped = ids.filter((id) => id !== keeper)
      for (const id of dropped) matches.delete(id)
      notes.push(
        keeper
          ? `${dropped.join(' and ')} also match ${pid}, which ${keeper} keeps`
          : `${ids.join(' and ')} all match ${pid}; none takes it`
      )
    }
    for (const m of matches.values()) {
      const n = rowsOf.get(m.product.productId) ?? 0
      if (n > 1)
        notes.push(
          `${m.bandaiId}: product ${m.product.productId} has ${n} price rows; left unpriced`
        )
    }
    // Counted once per product, though the promo pages both read the pool.
    const taken = new Set([...matches.values()].map((m) => m.product.productId))
    const all = new Map<number, OpProduct>()
    for (const list of products.values()) for (const p of list) all.set(p.productId, p)
    let tcgOnly = 0
    for (const p of all.values()) {
      if (productVersion(p).skip === null && !taken.has(p.productId)) tcgOnly++
    }

    // DON!! cards, from TCGCSV alone: a mapped group's go in its series' set, the pool's in the
    // promotion cards'.
    const seriesOfGroup = new Map<number, string>()
    for (const [id, g] of bySeries) seriesOfGroup.set(g.groupId, id)
    const promoSeries = series.find((s) => s.kind === 'promo')
    if (promoSeries) for (const g of promoPool) seriesOfGroup.set(g.groupId, promoSeries.id)
    const don = donCards([...all.values()], priceRows, (id) => seriesOfGroup.get(id))
    if (don.unplaced.length > 0)
      notes.push(`DON!! products in no series' group, left out: ${don.unplaced.join(', ')}`)

    // 6. Write.
    const written = writeOnePiece(
      work,
      {
        series,
        entries,
        groupOf: bySeries,
        matches,
        prices,
        hashed,
        frozen,
        firstSeen,
        don: { cards: don.cards, listed: don.listed, complete: failed.size === 0 },
        packShots: packs.shots
      },
      { now, nowIso: date.toISOString() }
    )

    // 7. Priced share against last night (Builder's call 14).
    for (const s of written.perSet) {
      const old = cache.getSetStats(s.setCode)
      // A set that only grew (more printings, none of its prices lost) is the catalog filling in, not a drop.
      if (old && old.printings > 0 && s.printings >= SHARE_SET_MIN && s.priced < old.priced) {
        // old share - new share >= 1 / SHARE_DROP_PARTS, in whole numbers (1 - 0.8 is under 0.2 in floats).
        const fell =
          SHARE_DROP_PARTS * (old.priced * s.printings - s.priced * old.printings) >=
          old.printings * s.printings
        if (fell) {
          problems.push(
            `${s.setCode} priced share fell from ${percent(old.priced, old.printings)}% to ${percent(s.priced, s.printings)}%`
          )
        }
      }
      cache.putSetStats(s)
    }

    return {
      report: { ...written, notes: [...notes, ...written.notes], tcgOnly, donHeld: don.held },
      error: null,
      problems
    }
  } catch (e) {
    // Problems found before the throw still stand: a first-noticed art change isn't raised again.
    return { report: null, error: e instanceof Error ? e.message : String(e), problems }
  } finally {
    opened?.close()
  }
}

/** The step's summary line, one line per set, then every note. */
export function logOnePiece(r: OnePieceReport, log: (line: string) => void): void {
  log(
    `One Piece en: ${r.series} series, ${r.cards} cards, ${r.printings} printings (${r.priced} priced, ${r.printings - r.priced} unpriced, ${r.held} held), ${r.images} images, ${r.tcgOnly} TCGplayer-only products skipped, ${r.don} DON!! cards (${r.donPriced} priced printings, ${r.donHeld} held), ${r.notes.length} notes`
  )
  for (const s of r.perSet) log(`One Piece en ${s.setCode}: ${s.priced}/${s.printings} priced`)
  for (const n of r.notes) log(`One Piece en: ${n}`)
}
