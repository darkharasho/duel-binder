import type Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { GameId } from '../../src/shared/games/types'
import type { TermEvidence, TermKind, TermTarget, TermTargetKind } from '../../src/shared/search/terms'
import type { Candidate } from './mine'

export const MODEL = 'claude-opus-5-5'
/** Opus 5.5 list prices, dollars per million tokens. */
export const INPUT_DOLLARS_PER_MTOK = 4
export const OUTPUT_DOLLARS_PER_MTOK = 20
const BATCH = 20

export const ResultSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      verdict: z.enum(['term', 'junk']),
      phrase: z.string(),
      kind: z.enum(['nickname', 'abbreviation', 'subset', 'rarity', 'cards']),
      targetKind: z.enum(['printing', 'card', 'set', 'rarity', 'cards']),
      target: z.object({
        pkeys: z.array(z.string()),
        cardIds: z.array(z.number()),
        sets: z.array(z.object({ language: z.string(), setName: z.string() })),
        rarities: z.array(z.string())
      }),
      reason: z.string()
    })
  )
})

/** The `/admin/terms/propose` item. */
export interface Proposal {
  game: GameId
  phrase: string
  kind: TermKind
  targetKind: TermTargetKind
  target: TermTarget
  evidence: TermEvidence
}

export interface Usage {
  input: number
  output: number
}

export const estimateCost = (u: Usage): number =>
  (u.input * INPUT_DOLLARS_PER_MTOK + u.output * OUTPUT_DOLLARS_PER_MTOK) / 1e6

/** The part of the SDK client this uses, so a test can pass a fake. */
export type ClassifyClient = Pick<Anthropic, 'beta'>

const system = (game: GameId): string =>
  `You are reviewing phrases taken from eBay listing titles for ${game} trading cards. ` +
  'Keep only phrases collectors use to mean a card, version, subset or rarity. ' +
  'Drop seller spam, condition, grading, shipping and generic words. ' +
  'Write the phrase the way collectors write it. ' +
  'Pick targets only from the options given for each phrase (copy pkeys, cardIds, sets and rarities exactly). ' +
  'Give a one-sentence reason. Mark anything else as junk, with an empty target. ' +
  'Return one result for each phrase id.'

const within = (picked: unknown[], allowed: unknown[]): boolean => {
  const ok = new Set(allowed.map((x) => JSON.stringify(x)))
  return picked.every((x) => ok.has(JSON.stringify(x)))
}

/** Reviews each candidate phrase with Claude; only phrases kept as terms and aimed inside their own options come back. */
export async function classify(
  client: ClassifyClient,
  game: GameId,
  cands: Candidate[],
  usage: Usage = { input: 0, output: 0 },
  log: (line: string) => void = console.log
): Promise<Proposal[]> {
  const out: Proposal[] = []
  for (let i = 0; i < cands.length; i += BATCH) {
    const batch = cands.slice(i, i + BATCH)
    const byId = new Map(batch.map((c) => [c.id, c]))
    const prompt = batch.map((c) => ({
      id: c.id,
      phrase: c.phrase,
      titles: c.sampleTitles.slice(0, 5),
      options: { pkeys: c.pkeys, cardIds: c.cardIds, sets: c.sets, rarities: c.rarities }
    }))
    const res = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { format: zodOutputFormat(ResultSchema) },
      system: system(game),
      messages: [{ role: 'user', content: JSON.stringify(prompt) }]
    })
    usage.input += res.usage.input_tokens
    usage.output += res.usage.output_tokens
    if (res.stop_reason === 'refusal' || !res.parsed_output) {
      log(`${game}: skipped a batch of ${batch.length} (${res.stop_reason ?? 'no output'})`)
      continue
    }
    for (const r of res.parsed_output.results) {
      const c = byId.get(r.id)
      if (!c || r.verdict !== 'term') continue
      const t = r.target
      if (
        t.pkeys.length + t.cardIds.length + t.sets.length + t.rarities.length === 0 ||
        !within(t.pkeys, c.pkeys) ||
        !within(t.cardIds, c.cardIds) ||
        !within(t.sets, c.sets) ||
        !within(t.rarities, c.rarities)
      )
        continue
      out.push({
        game,
        phrase: r.phrase,
        kind: r.kind,
        targetKind: r.targetKind,
        target: { pkeys: t.pkeys, cardIds: t.cardIds, sets: t.sets, rarities: t.rarities },
        evidence: { titles: c.sampleTitles.slice(0, 5), count: c.count, sellers: c.sellers, reason: r.reason }
      })
    }
  }
  return out
}
