/**
 * Sums up an admin scan trace session (userData/scan-trace/<session>, see src/main/scan/scanTrace.ts):
 * how the frames came out, and why the ones not recognized weren't.
 *
 *   npx tsx scripts/scan/trace-summary.ts <session dir> [--user-data ~/.config/duel-binder]
 *
 * Reasons, in the order they're judged:
 * - no-outline: no card found in the frame.
 * - art-not-in-file: a card the frame's lookups named (by name or code) has none of its artworks
 *   in this computer's fingerprint file, so its art could never match.
 * - unsure: close art but not sure enough to count.
 * - art-far: a card found, its art far from every fingerprint.
 * A wrong card recognized is left to a person to spot. Reads the catalog read-only (node:sqlite,
 * so no Electron build of better-sqlite3 is needed).
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { decodeFingerprints } from '../../src/shared/scan/fingerprintFile'

export type Reason = 'no-outline' | 'art-not-in-file' | 'art-far' | 'unsure'

export interface TraceLineJson {
  seq: number
  found: boolean
  outcome: 'none' | 'far' | 'unsure' | 'recognized'
  game?: string
  /** Main's named art, or the renderer's [imageId, distance] pairs. */
  art: (
    { imageId: number; distance: number; name: string | null; sets: string[] } | [number, number]
  )[]
  calls: { m: string; args: unknown; out?: unknown; error?: string; ms: number }[]
  frame?: string
  fpCount?: number
  card?: { cardId: number; name: string }
}

export interface Summary {
  frames: number
  outcomes: Record<string, number>
  reasons: { reason: Reason; frames: string[]; cards?: string[] }[]
}

const NAMING = new Set(['matchName', 'printingsByCode', 'printingsByNumber'])

/** The cards a frame's lookups named. */
function namedCards(l: TraceLineJson): number[] {
  const out = new Set<number>()
  const add = (v: unknown): void => {
    if (v && typeof v === 'object' && typeof (v as { cardId?: unknown }).cardId === 'number')
      out.add((v as { cardId: number }).cardId)
  }
  for (const c of l.calls ?? []) {
    if (!NAMING.has(c.m)) continue
    if (Array.isArray(c.out)) c.out.forEach(add)
    else if (
      c.out &&
      typeof c.out === 'object' &&
      Array.isArray((c.out as { first?: unknown }).first)
    )
      (c.out as { first: unknown[] }).first.forEach(add)
    else add(c.out)
  }
  return [...out]
}

export function summarize(
  lines: TraceLineJson[],
  hasArt: (imageId: number) => boolean,
  imagesOfCard: (cardId: number) => number[]
): Summary {
  const outcomes: Record<string, number> = {}
  const groups = new Map<Reason, { frames: string[]; cards: Set<string> }>()
  const note = (r: Reason, l: TraceLineJson, cards: number[] = []): void => {
    const g = groups.get(r) ?? { frames: [], cards: new Set<string>() }
    g.frames.push(l.frame ?? `#${l.seq}`)
    cards.forEach((c) => g.cards.add(String(c)))
    groups.set(r, g)
  }
  for (const l of lines) {
    outcomes[l.outcome] = (outcomes[l.outcome] ?? 0) + 1
    if (l.outcome === 'recognized') continue
    if (!l.found) {
      note('no-outline', l)
      continue
    }
    const missing = namedCards(l).filter((id) => {
      const imgs = imagesOfCard(id)
      return imgs.length > 0 && !imgs.some(hasArt)
    })
    if (missing.length) note('art-not-in-file', l, missing)
    else if (l.outcome === 'unsure') note('unsure', l)
    else note('art-far', l)
  }
  const order: Reason[] = ['no-outline', 'art-not-in-file', 'unsure', 'art-far']
  return {
    frames: lines.length,
    outcomes,
    reasons: order
      .filter((r) => groups.has(r))
      .map((r) => {
        const g = groups.get(r)!
        return { reason: r, frames: g.frames, ...(g.cards.size ? { cards: [...g.cards] } : {}) }
      })
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const at = args.indexOf('--user-data')
  const userData = at >= 0 ? args[at + 1]! : join(homedir(), '.config/duel-binder')
  const dir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--user-data')
  if (!dir) {
    console.error('Usage: npx tsx scripts/scan/trace-summary.ts <session dir> [--user-data <dir>]')
    process.exit(2)
  }
  const lines = readFileSync(join(dir, 'trace.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as TraceLineJson)
  const game = lines.find((l) => l.game)?.game ?? 'ygo'
  const bin = join(
    userData,
    'scan',
    game === 'ygo' ? 'fingerprints.bin' : `fingerprints-${game}.bin`
  )
  const index = existsSync(bin) ? decodeFingerprints(readFileSync(bin)) : null
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(join(userData, 'collection.db'), { readOnly: true })
  const imagesStmt = db.prepare('SELECT image_id FROM card_images WHERE card_id = ?')
  const nameStmt = db.prepare('SELECT name FROM cards WHERE id = ?')
  const s = summarize(
    lines,
    (id) => index?.hasImage(id) ?? false,
    (cardId) => (imagesStmt.all(cardId) as { image_id: number }[]).map((r) => r.image_id)
  )
  console.log(
    `${s.frames} frames (${game}); fingerprint file: ${index?.count ?? 'missing'} artworks, ${lines.at(-1)?.fpCount ?? '?'} when traced`
  )
  console.log(
    'Outcomes:',
    Object.entries(s.outcomes)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')
  )
  for (const r of s.reasons) {
    const cards = (r.cards ?? []).map((c) => {
      const row = nameStmt.get(Number(c)) as { name: string } | undefined
      return `${row?.name ?? '?'} (${c})`
    })
    console.log(`\n${r.reason}: ${r.frames.length}`)
    if (cards.length) console.log(`  cards: ${cards.join(', ')}`)
    console.log(`  frames: ${r.frames.slice(0, 10).join(' ')}${r.frames.length > 10 ? ' …' : ''}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main()
}
