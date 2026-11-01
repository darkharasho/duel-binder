/**
 * Speed gate for Binders (Task 10). Copies the real collection database to a temp file with
 * better-sqlite3's online backup (the live file is opened readonly and never written), migrates the
 * copy, saves test binders on the copy and times previewBinder, getBinder and listBinders against
 * the real catalog. No rows are synthesized. The copy is deleted at the end.
 *
 * Run (bundle with vite, then run under Electron so the Electron-built better-sqlite3 loads):
 *   npx vite build --ssr scripts/bench-binders.ts --outDir out/bench --emptyOutDir \
 *     && ELECTRON_RUN_AS_NODE=1 npx electron out/bench/bench-binders.mjs [path/to/collection.db]
 *
 * Limits: each single-binder call < 150 ms, listBinders of 50 < 1 s, Rarity = Common tooBroad < 50 ms.
 */
import Database from 'better-sqlite3'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import { migrate } from '../src/main/db/database'
import { LOCAL, localScope } from '../src/main/repo/scope'
import { narrowedRuleSql } from '../src/main/repo/binderRules'
import { getBinder, listBinders, previewBinder, saveBinder } from '../src/main/repo/binders'
import { MAX_BINDERS, type BinderDraft, type BinderGoal, type BinderRule } from '../src/shared/binders'
import type { Language } from '../src/shared/languages'

const src = process.argv[2] ?? path.join(os.homedir(), '.config', 'duel-binder', 'collection.db')
const tmp = path.join(os.tmpdir(), `bench-binders-${process.pid}.db`)

const ms = (f: () => unknown): number => {
  const t = performance.now()
  f()
  return performance.now() - t
}
const median = (a: number[]): number => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const RUNS = 5
const rows: { name: string; med: number; worst: number; limit: number }[] = []
const record = (name: string, limit: number, f: () => unknown): void => {
  f() // warm-up (page cache, statement compile) is excluded; the 5 timed runs follow
  const t = Array.from({ length: RUNS }, () => ms(f))
  rows.push({ name, med: median(t), worst: Math.max(...t), limit })
}

async function main(): Promise<void> {
  const live = new Database(src, { readonly: true, fileMustExist: true })
  await live.backup(tmp)
  live.close()
  const db = new Database(tmp)
  try {
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    migrate(db)
    const YGO = localScope("'ygo'")
    const PKM = localScope("'pkm'")
    const q = <T>(sql: string): T[] => db.prepare(sql).all() as T[]

    const draft = (name: string, rules: BinderRule[], goal: BinderGoal, languages: Language[] = []): BinderDraft => ({
      name, rules: { version: 1, rules }, goal, languages, friendsVisible: false
    })
    const artists = q<{ illustrator: string }>(
      "SELECT illustrator FROM pokemon_cards WHERE illustrator LIKE 'Asako Ito%' GROUP BY 1"
    )
    const artist = artists.find((a) => a.illustrator === 'Asako Ito')?.illustrator ?? artists[0]?.illustrator
    if (!artist) throw new Error('No Asako Ito in pokemon_cards.illustrator')
    console.log(`artist used: ${artist}`)

    const cases: { label: string; scope: typeof YGO; d: BinderDraft }[] = [
      ...(['none', 'card', 'art', 'printing'] as BinderGoal[]).map((g) => ({
        label: `BEWD name, all languages, goal ${g}`,
        scope: YGO,
        d: draft('BEWD', [{ field: 'name', op: 'is', value: 'Blue-Eyes White Dragon' }], g)
      })),
      ...(['card', 'printing'] as BinderGoal[]).map((g) => ({
        label: `Asako Ito artist, goal ${g}`,
        scope: PKM,
        d: draft('Ito', [{ field: 'artist', values: [artist] }], g)
      })),
      {
        label: 'race and rarity, no indexed field, goal printing',
        scope: YGO,
        d: draft('Race', [{ field: 'race', values: ['Dragon'] }, { field: 'rarity', values: ['Ultra Rare'] }], 'printing')
      },
      {
        label: 'contains Dragon, goal printing',
        scope: YGO,
        d: draft('Contains', [{ field: 'name', op: 'contains', value: 'Dragon' }], 'printing')
      }
    ]
    for (const c of cases) {
      const uid = saveBinder(db, c.d, new Date(), c.scope)
      record(`previewBinder: ${c.label}`, 150, () => previewBinder(db, c.d, c.scope))
      record(`getBinder: ${c.label}`, 150, () => getBinder(db, uid, c.scope))
    }
    const common = draft('Common', [{ field: 'rarity', values: ['Common'] }], 'printing')
    const tb = previewBinder(db, common, YGO)
    console.log(`Rarity = Common tooBroad: ${tb.tooBroad}`)
    const commonUid = saveBinder(db, common, new Date(), YGO)
    record('previewBinder: Rarity = Common (tooBroad)', 50, () => previewBinder(db, common, YGO))
    record('getBinder: Rarity = Common (tooBroad)', 50, () => getBinder(db, commonUid, YGO))

    // 50 realistic, mixed binders per game, built from the catalog's own most common values.
    const top = (sql: string): string[] => q<{ v: string }>(sql).map((r) => r.v)
    const ygoArch = top("SELECT archetype v FROM cards WHERE game='ygo' AND archetype IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 20")
    const ygoSets = top("SELECT set_name v FROM card_printings WHERE game='ygo' GROUP BY 1 ORDER BY count(*) DESC LIMIT 10")
    const ygoRar = ['Ultra Rare', 'Secret Rare', 'Super Rare', 'Ghost Rare']
    const pkmSets = top("SELECT set_name v FROM card_printings WHERE game='pkm' GROUP BY 1 ORDER BY count(*) DESC LIMIT 15")
    const pkmArtists = top("SELECT illustrator v FROM pokemon_cards WHERE illustrator IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 15")
    const pkmNames = ['Pikachu', 'Charizard', 'Eevee', 'Mewtwo', 'Gengar']
    const goals: BinderGoal[] = ['card', 'art', 'printing', 'none']
    const langs: Language[][] = [[], ['en'], ['ja'], ['en', 'ja']]
    // The case binders above count toward the 50-per-game cap, so fill up to exactly 50.
    const fill = (scope: typeof YGO): number => MAX_BINDERS - listBinders(db, scope).length
    for (let i = 0, n = fill(YGO); i < n; i++) {
      const g = goals[i % 4]
      const l = langs[i % 4]
      let rules: BinderRule[]
      if (i % 5 === 0) rules = [{ field: 'archetype', values: [ygoArch[i % ygoArch.length]] }]
      else if (i % 5 === 1) rules = [{ field: 'set', values: [ygoSets[i % ygoSets.length]] }]
      else if (i % 5 === 2) rules = [{ field: 'name', op: 'contains', value: ['Dragon', 'Magician', 'Dark'][i % 3] }, { field: 'rarity', values: ygoRar }]
      else if (i % 5 === 3) rules = [{ field: 'cardType', values: ['Effect Monster'] }, { field: 'attribute', values: ['DARK'] }, { field: 'rarity', values: [ygoRar[i % 4]] }]
      else rules = [{ field: 'archetype', values: [ygoArch[i % ygoArch.length]] }, { field: 'rarity', values: ygoRar }]
      saveBinder(db, draft(`Y${i}`, rules, g, l), new Date(), YGO)
    }
    for (let i = 0, n = fill(PKM); i < n; i++) {
      const g = (['card', 'printing', 'none'] as BinderGoal[])[i % 3]
      const l = langs[i % 4]
      let rules: BinderRule[]
      if (i % 4 === 0) rules = [{ field: 'artist', values: [pkmArtists[i % pkmArtists.length]] }]
      else if (i % 4 === 1) rules = [{ field: 'set', values: [pkmSets[i % pkmSets.length]] }]
      else if (i % 4 === 2) rules = [{ field: 'name', op: 'contains', value: pkmNames[i % 5] }]
      else rules = [{ field: 'name', op: 'is', value: pkmNames[i % 5] }, { field: 'category', values: ['Pokemon'] }]
      saveBinder(db, draft(`P${i}`, rules, g, l), new Date(), PKM)
    }
    const listed = { ygo: listBinders(db, YGO), pkm: listBinders(db, PKM) }
    console.log(
      `ygo binders ${listed.ygo.length} (tooBroad ${listed.ygo.filter((b) => b.tooBroad).length}), ` +
        `pkm binders ${listed.pkm.length} (tooBroad ${listed.pkm.filter((b) => b.tooBroad).length})`
    )
    record('listBinders: 50 ygo binders', 1000, () => listBinders(db, YGO))
    record('listBinders: 50 pkm binders', 1000, () => listBinders(db, PKM))
    // What the desktop runs: the same binders, with the game read from meta rather than a literal.
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('active_game', 'ygo')").run()
    record('listBinders: 50 ygo binders, LOCAL scope', 1000, () => listBinders(db, LOCAL))

    console.log('\ncase | median ms | worst ms | limit | result')
    for (const r of rows)
      console.log(`${r.name} | ${r.med.toFixed(1)} | ${r.worst.toFixed(1)} | ${r.limit} | ${r.worst < r.limit ? 'PASS' : r.med < r.limit ? 'PASS(median) worst over' : 'FAIL'}`)

    const slowest = [...rows].filter((r) => !r.name.startsWith('listBinders')).sort((a, b) => b.worst - a.worst)[0]
    console.log(`\nslowest single call: ${slowest.name}`)
    const slowRuleCase = cases.find((c) => slowest.name.endsWith(c.label))
    const d = slowRuleCase?.d ?? common
    const sc = slowRuleCase?.scope ?? YGO
    // Plan of the printing query every call runs (matchedPrintingCount / loadSlots share this WHERE).
    const { sql, params } = narrowedRuleSql(db, d.rules, d.languages, sc)
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT p.id FROM card_printings p
         JOIN cards c ON c.id = p.card_id AND +c.game = ${sc.game}
         LEFT JOIN pokemon_cards pc ON pc.card_id = c.id
         WHERE +p.game = ${sc.game} AND ${sql}`
      )
      .all(...(params as never[])) as { detail: string }[]
    for (const p of plan) console.log(`  ${p.detail}`)
  } finally {
    db.close()
    for (const s of ['', '-wal', '-shm']) fs.rmSync(tmp + s, { force: true })
  }
}

main().catch((e) => {
  console.error(e)
  fs.rmSync(tmp, { force: true })
  process.exit(1)
})
