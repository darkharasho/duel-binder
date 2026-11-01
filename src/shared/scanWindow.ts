import type { Language } from './languages'
import type { FingerprintStatus, ScanDraft } from './scan/types'

/** What the scan loop is doing; the scan window reports it, the Scan page words it. */
export type ScanStatus =
  | { kind: 'idle' }
  | { kind: 'unsure' }
  | { kind: 'reading' }
  | { kind: 'photo-failed' }
  | { kind: 'added'; name: string; setCode: string | null; guess?: true }
  | { kind: 'stopped' }

/** The languages a Pokémon card is catalogued in. */
export const POKEMON_LANGUAGES = ['en', 'ja'] as const
export type PokemonLanguage = (typeof POKEMON_LANGUAGES)[number]

export const isPokemonLanguage = (v: unknown): v is PokemonLanguage =>
  (POKEMON_LANGUAGES as readonly unknown[]).includes(v)

/** The language a live Pokémon scan takes cards to be in: the picked set's, or the one chosen. */
export function liveLanguage(s: Pick<ScanWindowSettings, 'set' | 'scanLanguage'>): PokemonLanguage {
  return isPokemonLanguage(s.set?.language) ? s.set.language : s.scanLanguage
}

/** What the main window tells the scan window to scan with. */
export interface ScanWindowSettings {
  deviceId: string | null
  paused: boolean
  set: { setName: string; language: Language } | null
  /** The language live Pokémon cards are scanned in, with no set of a language picked. */
  scanLanguage: PokemonLanguage
  defaultRarity: string | null
  hitPrice: number
  /** How the camera fills the window: cropped to fill it, or the whole picture, letterboxed. */
  fit: ScanFit
  /** How far the picture is zoomed in on its centre, one of SCAN_ZOOMS (1 is not at all). */
  zoom: number
}

export type ScanFit = 'fill' | 'whole'
export const SCAN_ZOOMS = [1, 1.25, 1.5, 2, 2.5, 3] as const

/** What the scan window reports back for the Scan page to show. */
export interface ScanWindowState {
  devices: { deviceId: string; label: string }[]
  /** The camera actually open, from its track settings. */
  openDeviceId: string | null
  cameraError: 'denied' | 'none' | 'lost' | 'busy' | null
  loop: ScanStatus
  artReady: boolean | null
  /** Where the artwork data stands, while there is none to match against. */
  artData?: FingerprintStatus | null
  setUnreadable: boolean
}

/** The list so far, for the opaque summary screen the main window can put over the camera. */
export interface ScanSummary {
  /** The list's value; copies with no price are left out, never counted as $0. */
  value: number
  cards: number
  hits: number
  unpriced: number
  /** The dearest priced rows, dearest first. */
  top: { key: string; name: string; imageId: number; price: number; raw: boolean; guess: boolean }[]
}

export type ToScanWindow =
  | { kind: 'settings'; settings: ScanWindowSettings }
  | { kind: 'retryCamera' }
  | { kind: 'retryScan' }
  | { kind: 'takePhoto' }
  /** The draft with this id is on the list; the scan window stops resending it. */
  | { kind: 'ack'; id: string }
  /** Shows the summary screen with these numbers, or takes it away. */
  | { kind: 'summary'; summary: ScanSummary | null }

export type FromScanWindow =
  | { kind: 'ready' }
  | { kind: 'state'; state: ScanWindowState }
  /** A pull to count. Resent until acknowledged, so the same id can arrive more than once. */
  | { kind: 'draft'; id: string; draft: ScanDraft }

export type ScanWindowMessage = ToScanWindow | FromScanWindow

const TO: readonly string[] = [
  'settings',
  'retryCamera',
  'retryScan',
  'takePhoto',
  'ack',
  'summary'
]
const FROM: readonly string[] = ['ready', 'state', 'draft']

const kindOf = (v: unknown): unknown =>
  typeof v === 'object' && v !== null ? (v as { kind?: unknown }).kind : undefined

export const isToScanWindow = (v: unknown): v is ToScanWindow => {
  const k = kindOf(v)
  return typeof k === 'string' && TO.includes(k)
}

export const isFromScanWindow = (v: unknown): v is FromScanWindow => {
  const k = kindOf(v)
  return typeof k === 'string' && FROM.includes(k)
}
