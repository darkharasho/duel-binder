import { describe, expect, test } from 'vitest'
import {
  GAMES,
  allowedGames,
  byGame,
  gameDef,
  gameOfId,
  isGameId,
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
  test('gameOfId boundaries', () => {
    expect(gameOfId(2 ** 39 - 1)).toBe('ygo')
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
    expect(allowedGames({ isOwner: true, testerGames: [] })).toEqual(['ygo', 'pkm', 'op'])
  })
  test('One Piece definition', () => {
    const op = gameDef('op')
    expect(op.name).toBe('One Piece')
    expect(op.features).toEqual({ scan: true, rip: false })
    expect(op.cardAspect).toEqual({ width: 600, height: 838 })
    expect([op.access, op.priceRule, op.crossLanguagePriceFallback]).toEqual(['testers', 'marketOnly', false])
    expect(isGameId('op')).toBe(true)
    expect(new Set(Object.values(GAMES).map((g) => g.color)).size).toBe(3)
  })
  test('byGame picks the game value', () => expect(byGame('op', { ygo: 1, pkm: 2, op: 3 })).toBe(3))
  test('features', () => {
    expect(gameDef('ygo').features).toEqual({ scan: true, rip: true })
    expect(gameDef('pkm').features).toEqual({ scan: true, rip: false })
    expect(gameDef('pkm').access).toBe('everyone')
    expect(gameDef('pkm').crossLanguagePriceFallback).toBe(false)
  })
  test('vocab and guards', () => {
    expect(isGameId('pkm')).toBe(true)
    expect(isGameId('mtg')).toBe(false)
    expect(gameDef('ygo').vocab.regionLabel('ja')).toBe('OCG')
    expect(gameDef('ygo').vocab.regionLabel('en')).toBe('TCG')
    expect(gameDef('pkm').vocab.regionLabel('ja')).toBe('Japanese')
  })
})
