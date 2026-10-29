import { describe, expect, test } from 'vitest'
import { allowedGames, gameDef, gameOfId, isGameId, pokemonId } from '../../src/shared/games'
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
  test('Pokémon is owner-only', () => {
    expect(allowedGames(false)).toEqual(['ygo'])
    expect(allowedGames(true)).toEqual(['ygo', 'pkm'])
  })
  test('features', () => {
    expect(gameDef('ygo').features).toEqual({ scan: true, rip: true })
    expect(gameDef('pkm').features).toEqual({ scan: false, rip: false })
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
