// @vitest-environment node
// The Pokémon scanner's best-guess rules replayed offline, each set of them over the signals a
// real-photo gate saved (see SCAN_PKM_OUT in scan-pkm-real.test.ts), so a point on the curve can
// be chosen without running the vision and OCR again:
//   SCAN_PKM_DIR=~/scan-capture SCAN_PKM_RAW=<SCAN_PKM_OUT file> [SCAN_PKM_CURVE=<out.json>]
//   npx vitest run --maxWorkers=2 --silent=false tests/main/scan-pkm-guess-curve.test.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import {
  cardsForImages,
  matchName,
  printingsByCode,
  printingsByNumber,
  printingsForCards
} from '../../src/main/repo/scan'
import { localScope } from '../../src/main/repo/scope'
import { pokemonId } from '../../src/shared/games/ids'
import type { PokemonTextLanguage } from '../../src/shared/scan/pokemonLanguage'
import type { PkmGuessRule } from '../../src/shared/scan/thresholds'
import { resolveSignals, type ResolveContext } from '../../src/renderer/src/features/scan/resolve'
import { problemsOf, type Truth } from './scan-pkm-score'

const home = (p: string): string => p.replace(/^~/, homedir())
const DIR = process.env.SCAN_PKM_DIR ? home(process.env.SCAN_PKM_DIR) : undefined
const RAW = process.env.SCAN_PKM_RAW ? home(process.env.SCAN_PKM_RAW) : undefined

const ALL: PkmGuessRule[] = [
  'language',
  'language-default',
  'reprint',
  'misread',
  'twin',
  'behind',
  'holder'
]
/** Every combination of the rules. */
const VARIANTS: PkmGuessRule[][] = Array.from({ length: 1 << ALL.length }, (_, bits) =>
  ALL.filter((_, i) => bits & (1 << i))
)

interface Saved {
  rows: { file: string; result: string }[]
  raws: Record<
    string,
    {
      found: boolean
      quad: null
      art: { imageId: number; distance: number }[]
      codeTexts: string[]
      nameTexts: string[]
      version: unknown
      slab: boolean
      artVia?: 'holder'
      language: PokemonTextLanguage
      localNames: string[]
    }
  >
}

describe.skipIf(!DIR || !RAW || !existsSync(RAW))('Pokémon best guesses, replayed', () => {
  it('holds with no rules to the gate that saved the signals, and tabulates the rest', async () => {
    const saved = JSON.parse(readFileSync(RAW!, 'utf8')) as Saved
    const truth = new Map(
      (JSON.parse(readFileSync(join(DIR!, 'pkm-truth.json'), 'utf8')) as Truth[]).map((t) => [
        t.file,
        t
      ])
    )
    const db = new Database(join(DIR!, 'pkm-work', 'catalog.sqlite'), {
      readonly: true,
      fileMustExist: true
    })
    const scope = localScope("'pkm'")
    const memo = <A, R>(f: (a: A) => R): ((a: A) => Promise<R>) => {
      const known = new Map<string, R>()
      return async (a) => {
        const key = JSON.stringify(a)
        if (!known.has(key)) known.set(key, f(a))
        return known.get(key)!
      }
    }
    const lookups: ResolveContext['lookups'] = {
      printingsByCode: memo((code) => printingsByCode(db, code as string, scope)),
      printingsByNumber: memo((n) =>
        printingsByNumber(db, n as Parameters<typeof printingsByNumber>[1], scope)
      ),
      printingsForCards: memo((ids) => printingsForCards(db, ids as number[], scope)),
      matchName: memo((text) => matchName(db, text as string, scope)),
      cardsForImages: memo((ids) => cardsForImages(db, ids as number[], scope))
    } as ResolveContext['lookups']

    const replay = async (guessRules: PkmGuessRule[]): Promise<Record<string, string>> => {
      const results: Record<string, string> = {}
      for (const { file, result } of saved.rows) {
        const r = saved.raws[file]
        if (!r) {
          results[file] = result
          continue
        }
        const t = truth.get(file)!
        const { language, localNames, ...signals } = r
        const outcome = await resolveSignals(
          { ...signals, textBands: [], cues: null, look: null } as never,
          {
            game: 'pkm',
            guessRules,
            setName: null,
            setPrintings: null,
            defaultRarity: null,
            lookups,
            readLanguage: async () => language,
            readLocalName: async () => localNames
          }
        )
        const cardId = t.sourceId ? pokemonId(t.sourceId) : null
        results[file] =
          outcome.kind === 'recognized'
            ? problemsOf(t, cardId, outcome.item).length
              ? 'wrong'
              : 'right'
            : outcome.kind
      }
      return results
    }

    // With no guesses the replay must be the gate, or the curve below measures nothing.
    const certain = await replay([])
    expect(saved.rows.filter((r) => certain[r.file] !== r.result)).toEqual([])

    const stats = (results: Record<string, string>, source?: string): Record<string, number> => {
      const rows = saved.rows.filter((r) => !source || truth.get(r.file)!.source === source)
      const n = (k: string): number => rows.filter((r) => results[r.file] === k).length
      return { right: n('right'), wrong: n('wrong') }
    }
    const pct = ({ right, wrong }: Record<string, number>): string =>
      `${right}/${wrong} ${((100 * wrong) / (right + wrong || 1)).toFixed(1)}%`
    const table: Record<string, unknown>[] = []
    const out: Record<string, unknown> = {}
    for (const rules of VARIANTS) {
      const results = await replay(rules)
      out[rules.join('+') || 'none'] = results
      table.push({
        rules: rules.join('+') || 'none',
        owner: pct(stats(results, 'owner')),
        ebay: pct(stats(results, 'ebay')),
        combined: pct(stats(results)),
        right: stats(results).right,
        'zh wrong': saved.rows.filter(
          (r) => truth.get(r.file)!.language === 'zh' && results[r.file] === 'wrong'
        ).length
      })
    }
    console.table(table.sort((a, b) => Number(b.right) - Number(a.right)))
    if (process.env.SCAN_PKM_CURVE)
      writeFileSync(home(process.env.SCAN_PKM_CURVE), JSON.stringify({ table, out }))
    db.close()
  }, 3_600_000)
})
