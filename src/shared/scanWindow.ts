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
  /** How far the picture is zoomed in on its centre, 1 (not at all) to SCAN_ZOOM_MAX. */
  zoom: number
}

export type ScanFit = 'fill' | 'whole'
export const SCAN_ZOOM_MAX = 3
export const SCAN_ZOOM_STEP = 0.05

/** Sizes a stream layout usually wants, in the pixels a capture sees. */
export const SCAN_SIZES = [
  { width: 1280, height: 720 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3840, height: 2160 },
  { width: 1080, height: 1920 },
  { width: 1080, height: 1080 }
] as const
export const SCAN_SIZE_MAX = 7680

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
  /** The window's picture in the pixels a capture sees, not screen points. */
  size?: { width: number; height: number }
}

export interface ScanSummaryCard {
  key: string
  name: string
  imageId: number
  /** Set code and rarity, as far as the row knows them. */
  detail: string
  quantity: number
  /** One copy's price. */
  price: number | null
  raw: boolean
  guess: boolean
}

/** The list so far, for the opaque summary screen the main window can put over the camera. */
export interface ScanSummary {
  /** The list's value; copies with no price are left out, never counted as $0. */
  value: number
  cards: number
  hits: number
  unpriced: number
  /** The dearest card known to be in hand; a best guess can't be it. */
  hit: ScanSummaryCard | null
  /** Every row, dearest first, the ones with no price last. */
  list: ScanSummaryCard[]
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
