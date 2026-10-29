import type { SqlDb } from '../../src/main/db/sql'
import { pokemonId } from '../../src/shared/games'

/** An English Yu-Gi-Oh! set in the fixtures; one Pokémon set has exactly this name too. */
export const SHARED_SET_NAME = 'Legend of Blue Eyes White Dragon'

interface PokemonFixture {
  sourceId: string
  language: string
  name: string
  hp: number
  types: string[]
  stage: string
  rarity: string
  illustrator: string
  setName: string
  setCode: string
  number: string
}

const POKEMON: PokemonFixture[] = [
  {
    sourceId: 'sv02-045',
    language: 'en',
    name: 'Pikachu',
    hp: 60,
    types: ['Lightning'],
    stage: 'Basic',
    rarity: 'Common',
    illustrator: 'Naoyo Kimura',
    setName: SHARED_SET_NAME,
    setCode: 'PAL',
    number: 'PAL 045/193'
  },
  {
    sourceId: 'ja/SV2D-030',
    language: 'ja',
    name: 'ピカチュウ',
    hp: 70,
    types: ['Lightning'],
    stage: 'Basic',
    rarity: 'Common',
    illustrator: 'Atsuko Nishida',
    setName: 'クレイバースト',
    setCode: 'SV2D',
    number: 'SV2D 030/071'
  }
]

const VERSIONS = ['Normal', 'Reverse Holo']

/**
 * Two Pokémon cards (one English, one Japanese), each with a Normal and a Reverse Holo printing,
 * an image and its `pokemon_cards` row. Needs the V19 schema; works on desktop and server.
 */
export function seedPokemon(db: SqlDb): { cardIds: number[]; printingIds: number[] } {
  const cardIds: number[] = []
  const printingIds: number[] = []
  const card = db.prepare(
    `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
     VALUES (?, 'pkm', ?, 'Pokémon', 'pokemon', ?, '', '2026-10-29')`
  )
  const image = db.prepare(
    "INSERT INTO card_images (image_id, game, card_id, sort_order) VALUES (?, 'pkm', ?, 0)"
  )
  const details = db.prepare(
    `INSERT INTO pokemon_cards (card_id, category, hp, types, stage, rarity, illustrator, source_id)
     VALUES (?, 'Pokémon', ?, ?, ?, ?, ?, ?)`
  )
  const set = db.prepare(
    "INSERT OR IGNORE INTO sets (game, language, set_name, set_code) VALUES ('pkm', ?, ?, ?)"
  )
  const printing = db.prepare(
    `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
     VALUES ('pkm', ?, ?, ?, ?, ?)`
  )
  db.transaction(() => {
    for (const p of POKEMON) {
      const id = pokemonId(p.sourceId)
      card.run(id, p.name, p.stage)
      image.run(id, id)
      details.run(id, p.hp, JSON.stringify(p.types), p.stage, p.rarity, p.illustrator, p.sourceId)
      set.run(p.language, p.setName, p.setCode)
      for (const version of VERSIONS) {
        const r = printing.run(id, p.language, p.setName, p.number, version)
        printingIds.push(Number(r.lastInsertRowid))
      }
      cardIds.push(id)
    }
  })()
  return { cardIds, printingIds }
}
