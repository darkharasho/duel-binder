import { describe, expect, test } from 'vitest'
import {
  GAMES,
  allowedGames,
  byGame,
  gameDef,
  gameOfId,
  isGameId,
  mtgCardId,
  mtgId,
  mtgImageId,
  onePieceCardId,
  onePieceId,
  onePieceImageId,
  pokemonId
} from '../../src/shared/games'
import { sha256 } from '../../src/shared/games/ids'



const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')

describe('games', () => {
  test('sha256 matches known vectors', () => {
    const enc = new TextEncoder()
    expect(hex(sha256(enc.encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
    expect(hex(sha256(enc.encode('')))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    )
    expect(hex(sha256(enc.encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
    )
  })
  test('pokemonId is stable, in range, and distinct for distinct ids', () => {
    expect(pokemonId('sv02-045')).toBe(pokemonId('sv02-045'))
    for (const id of ['sv02-045', 'SV1S-001', 'base1-4', 'csv8c-001']) {
      const n = pokemonId(id)
      expect(Number.isSafeInteger(n)).toBe(true)
      expect(n).toBeGreaterThanOrEqual(2 ** 40)
      expect(gameOfId(n)).toBe('pkm')
    }
    expect(pokemonId('sv02-045')).not.toBe(pokemonId('sv02-046'))
  })
  test('Yu-Gi-Oh ids are ygo', () => expect(gameOfId(89631139)).toBe('ygo'))
  test('onePieceId golden values', () => {
    // cards: one number per region
    expect(onePieceCardId('en', 'OP05-119')).toBe(668695884659)
    expect(onePieceCardId('en', 'OP01-001')).toBe(570006248710)
    expect(onePieceCardId('en', 'ST10-003')).toBe(745026503623)
    // images: one Bandai entry each
    expect(onePieceImageId('en', 'OP05-119')).toBe(664718050776)
    expect(onePieceImageId('en', 'OP05-119_p1')).toBe(1051636995080)
    expect(onePieceImageId('en', 'OP01-001')).toBe(996841831959)
    expect(onePieceImageId('en', 'OP01-001_p1')).toBe(847381541175)
    expect(onePieceImageId('en', 'OP05-119_p1')).toBe(onePieceId('en/OP05-119_p1#img'))
    for (const s of ['en/OP05-119', 'en/OP01-001', 'en/P-084', 'en/OP05-119_p1#img']) {
      const n = onePieceId(s)
      expect(n).toBeGreaterThanOrEqual(2 ** 39)
      expect(n).toBeLessThan(2 ** 40)
      expect(gameOfId(n)).toBe('op')
    }
  })
  test('mtgId lands in [2^38, 2^39) and is a safe integer', () => {
    const hexd = '0123456789abcdef'
    let seed = 12345
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed
    }
    for (let i = 0; i < 1000; i++) {
      let u = ''
      for (let c = 0; c < 36; c++) u += c === 8 || c === 13 || c === 18 || c === 23 ? '-' : hexd[rnd() % 16]
      const n = mtgId(u)
      expect(Number.isSafeInteger(n)).toBe(true)
      expect(n).toBeGreaterThanOrEqual(2 ** 38)
      expect(n).toBeLessThan(2 ** 39)
      expect(gameOfId(n)).toBe('mtg')
    }
  })
  test('mtgId golden values', () => {
    // Computed independently (sha256 of "mtg:<source id>"). PERMANENT once shipped: ids are stored and synced.
    expect(mtgCardId('en', 'e3285e6b-3e79-4d7c-bf96-d920f973b122')).toBe(415429220149)
    expect(mtgImageId('77c6fa74-5543-42ac-9ead-0e890b188e99')).toBe(468359245195)
    expect(mtgImageId('77C6FA74-5543-42AC-9EAD-0E890B188E99')).toBe(468359245195)
    expect(mtgCardId('en', 'E3285E6B-3E79-4D7C-BF96-D920F973B122')).toBe(415429220149)
    expect(mtgCardId('en', 'e3285e6b-3e79-4d7c-bf96-d920f973b122')).toBe(
      mtgId('en/e3285e6b-3e79-4d7c-bf96-d920f973b122')
    )
  })
  test('GAMES.mtg', () => {
    const m = gameDef('mtg')
    expect(m.name).toBe('Magic')
    expect(m.color).toBe('#c2410c')
    expect(m.features).toEqual({ scan: false, pokedex: false })
    expect(m.cardAspect).toEqual({ width: 488, height: 680 })
    expect([m.access, m.priceRule, m.crossLanguagePriceFallback]).toEqual(['testers', 'marketOnly', false])
    expect(new Set(Object.values(GAMES).map((g) => g.color)).size).toBe(4)
  })
  test('gameOfId boundaries', () => {
    expect(gameOfId(2 ** 38 - 1)).toBe('ygo')
    expect(gameOfId(2 ** 38)).toBe('mtg')
    expect(gameOfId(2 ** 39 - 1)).toBe('mtg')
    expect(gameOfId(2 ** 39 - 1)).not.toBe('ygo')
    expect(gameOfId(2 ** 39 - 1)).toBe('mtg')
    expect(gameOfId(2 ** 39)).toBe('op')
    expect(gameOfId(2 ** 39)).toBe('op')
    expect(gameOfId(2 ** 40 - 1)).toBe('op')
    expect(gameOfId(2 ** 40)).toBe('pkm')
    expect(gameOfId(2 ** 31 - 1)).toBe('ygo') // top of the token range
    expect(gameOfId(pokemonId('sv02-045'))).toBe('pkm') // Pokémon unchanged
  })
  test('pokemonId is byte-identical', () => {
    // Computed from today's pokemonId (sha256 of 'pkm:en/me05-068', folded into [2^40, 2^53)).
    expect(pokemonId('en/me05-068')).toBe(2449488009539745)
  })
  test('access: testers see a testers game, the owner sees all', () => {
    expect(allowedGames({ isOwner: false, testerGames: [] })).toEqual(['ygo', 'pkm'])
    expect(allowedGames({ isOwner: false, testerGames: ['op'] })).toEqual(['ygo', 'pkm', 'op'])
    expect(allowedGames({ isOwner: true, testerGames: [] })).toEqual(['ygo', 'pkm', 'op', 'mtg'])
    expect(allowedGames({ isOwner: false, testerGames: ['mtg'] })).toEqual(['ygo', 'pkm', 'mtg'])
  })
  test('One Piece definition', () => {
    const op = gameDef('op')
    expect(op.name).toBe('One Piece')
    expect(op.features).toEqual({ scan: true, pokedex: false })
    expect(op.cardAspect).toEqual({ width: 600, height: 838 })
    expect([op.access, op.priceRule, op.crossLanguagePriceFallback]).toEqual(['testers', 'marketOnly', false])
    expect(isGameId('op')).toBe(true)
    expect(new Set(Object.values(GAMES).map((g) => g.color)).size).toBe(4)
  })
  test('byGame picks the game value', () => expect(byGame('op', { ygo: 1, pkm: 2, op: 3, mtg: 4 })).toBe(3))
  test('features', () => {
    expect(gameDef('ygo').features).toEqual({ scan: true, pokedex: false })
    expect(gameDef('pkm').features).toEqual({ scan: true, pokedex: true })
    expect(gameDef('pkm').access).toBe('everyone')
    expect(gameDef('pkm').crossLanguagePriceFallback).toBe(false)
  })
  test('vocab and guards', () => {
    expect(isGameId('pkm')).toBe(true)
    expect(isGameId('mtg')).toBe(true)
    expect(isGameId('xyz')).toBe(false)
    expect(gameDef('ygo').vocab.regionLabel('ja')).toBe('OCG')
    expect(gameDef('ygo').vocab.regionLabel('en')).toBe('TCG')
    expect(gameDef('pkm').vocab.regionLabel('ja')).toBe('Japanese')
  })
})
