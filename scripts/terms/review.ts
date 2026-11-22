import { z } from 'zod'
import type { GameId } from '../../src/shared/games/types'
import { MAX_TERM_WORDS, TARGET_LIST, confineTarget, termWords, type TermEvidence, type TermKind, type TermTarget, type TermTargetKind } from '../../src/shared/search/terms'
import type { Candidate } from './mine'

const MAX_PHRASE = 80

/** The portal refuses a whole proposal batch over one phrase this fails (checkPhrase). */
export const phraseOk = (p: string): boolean => {
  const n = termWords(p).length
  return p.length <= MAX_PHRASE && n >= 1 && n <= MAX_TERM_WORDS
}

/**
 * One reviewed candidate, as written in the reviews file during a Claude Code session. Candidates
 * left out of the file count as junk; a target needs only the list its kind names.
 */
export const ReviewSchema = z.object({
  id: z.string(),
  verdict: z.enum(['term', 'junk']).default('term'),
  phrase: z.string(),
  kind: z.enum(['nickname', 'abbreviation', 'subset', 'rarity', 'cards']),
  targetKind: z.enum(['printing', 'card', 'set', 'rarity', 'cards']),
  target: z
    .object({
      pkeys: z.array(z.string()).default([]),
      cardIds: z.array(z.number()).default([]),
      sets: z.array(z.object({ language: z.string(), setName: z.string() })).default([]),
      rarities: z.array(z.string()).default([])
    })
    .prefault({}),
  reason: z.string()
})
export const ReviewsSchema = z.array(ReviewSchema)
export type Review = z.infer<typeof ReviewSchema>

/** The `/admin/terms/propose` item. */
export interface Proposal {
  game: GameId
  phrase: string
  kind: TermKind
  targetKind: TermTargetKind
  target: TermTarget
  evidence: TermEvidence
}

const within = (picked: unknown[], allowed: unknown[]): boolean => {
  const ok = new Set(allowed.map((x) => JSON.stringify(x)))
  return picked.every((x) => ok.has(JSON.stringify(x)))
}

/**
 * Turns reviews into proposals. Only reviews kept as terms, with a phrase the portal accepts and a
 * target inside their own candidate's options, come back; `log` names each one dropped.
 */
export function toProposals(
  cands: Candidate[],
  reviews: Review[],
  log: (line: string) => void = console.log
): Proposal[] {
  const byId = new Map(cands.map((c) => [c.id, c]))
  const out: Proposal[] = []
  for (const r of reviews) {
    const c = byId.get(r.id)
    if (r.verdict !== 'term') continue
    if (!c) {
      log(`${r.id}: no such candidate, dropped`)
      continue
    }
    if (!phraseOk(r.phrase)) {
      log(`${r.id}: phrase "${r.phrase}" too long or empty, dropped`)
      continue
    }
    // Only the list the target kind names counts: searches read only that list, so a stray one
    // would narrow the term out of sight.
    const key = TARGET_LIST[r.targetKind]
    const picked: unknown[] = r.target[key]
    if (picked.length === 0 || !within(picked, c[key])) {
      log(`${r.id}: target ${key} empty or outside the candidate's options, dropped`)
      continue
    }
    out.push({
      game: c.game,
      phrase: r.phrase,
      kind: r.kind,
      targetKind: r.targetKind,
      target: confineTarget(r.targetKind, r.target),
      evidence: { titles: c.sampleTitles.slice(0, 5), count: c.count, sellers: c.sellers, reason: r.reason }
    })
  }
  return out
}
