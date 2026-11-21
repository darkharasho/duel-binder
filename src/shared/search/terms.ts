import type { GameId } from '../games/types'

export const MAX_TERM_WORDS = 4

export type TermKind = 'nickname' | 'abbreviation' | 'subset' | 'rarity' | 'cards'
export type TermTargetKind = 'printing' | 'card' | 'set' | 'rarity' | 'cards'
export type TermStatus = 'pending' | 'approved' | 'rejected'

export interface TermTarget {
  pkeys?: string[]
  cardIds?: number[]
  sets?: { language: string; setName: string }[]
  rarities?: string[]
}

export interface SearchTerm {
  id: number
  game: GameId
  phrase: string
  phraseKey: string
  kind: TermKind
  targetKind: TermTargetKind
  target: TermTarget
  status: TermStatus
  source: 'ebay-ai' | 'owner' | 'user'
  seq: number
}

export interface TermEvidence {
  titles: string[]
  count: number
  sellers: number
  reason: string
}

/** Human-readable label for a term target, e.g. "Mew ex · Paldean Fates 232/91". */
export interface TermNote {
  phrase: string
  label: string
}

/**
 * Canonical form used to compare phrases: accent-free, lowercase, words separated by single spaces.
 * Only Latin combining diacritics are stripped, so Japanese voicing marks (ガ = カ + U+3099) survive
 * and are recomposed by NFC.
 */
export function termKey(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]+/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim()
}

export function termWords(s: string): string[] {
  return termKey(s).split(' ').filter(Boolean)
}

/** A term as the portal feed sends it. */
export type WireTerm = Pick<
  SearchTerm,
  'id' | 'game' | 'phrase' | 'phraseKey' | 'kind' | 'targetKind' | 'target' | 'seq'
>

/** GET /api/sync/search-terms: terms approved after `since`, ids that left approved, next cursor. */
export interface TermFeed {
  terms: WireTerm[]
  deleted: number[]
  cursor: number
  more: boolean
}
