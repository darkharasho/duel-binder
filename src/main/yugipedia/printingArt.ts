import type { Language } from '../../shared/languages'

/** Yugipedia file-name region codes per language, best first (old English sets use NA/EU/AU). */
const REGIONS: Record<Language, string[]> = {
  en: ['EN', 'NA', 'EU', 'AU'],
  ja: ['JP'],
  ko: ['KR'],
  de: ['DE'],
  fr: ['FR', 'FC'],
  it: ['IT'],
  es: ['SP'],
  pt: ['PT'],
  'zh-hans': ['SC'],
  'zh-hant': ['TC'],
  ae: ['AE'],
  'ja-asia': ['JA']
}

/** Rarity names (as stored) to the abbreviations Yugipedia puts in file names. */
const RARITY_ABBR: Record<string, string> = {
  common: 'C',
  rare: 'R',
  'super rare': 'SR',
  'ultra rare': 'UR',
  'secret rare': 'ScR',
  'ultimate rare': 'UtR',
  'ghost rare': 'GR',
  'gold rare': 'GUR',
  'gold secret rare': 'GScR',
  'ghost/gold rare': 'GGR',
  'premium gold rare': 'PGR',
  'prismatic secret rare': 'PScR',
  'platinum rare': 'PlR',
  'platinum secret rare': 'PlScR',
  'starlight rare': 'StR',
  "collector's rare": 'CR',
  'quarter century secret rare': 'QCScR',
  'starfoil rare': 'SFR',
  'shatterfoil rare': 'SHR',
  'mosaic rare': 'MSR',
  'short print': 'SP',
  'super short print': 'SSP',
  'parallel rare': 'PR',
  'ultra parallel rare': 'UPR',
  'super parallel rare': 'SPR',
  'normal parallel rare': 'NPR',
  'secret parallel rare': 'ScPR',
  'duel terminal normal parallel rare': 'DNPR',
  'duel terminal rare parallel rare': 'DRPR',
  'duel terminal super parallel rare': 'DSPR',
  'duel terminal ultra parallel rare': 'DUPR',
  'duel terminal secret parallel rare': 'DScPR',
  '10000 secret rare': '10000ScR',
  'holographic rare': 'HR',
  'extra secret rare': 'EScR',
  'millennium rare': 'MLR',
  'millennium secret rare': 'MLScR',
  'millennium ultra rare': 'MLUR',
  'millennium super rare': 'MLSR',
  'millennium gold rare': 'MLGR'
}

/**
 * File-name rarity code from the rarity name; the stored YGOPRODeck code like "(UR)" only as a
 * fallback, since a few differ from Yugipedia's (e.g. "(PS)" for Platinum Secret Rare).
 */
export function rarityAbbr(rarity: string, rarityCode = ''): string | null {
  const byName = RARITY_ABBR[rarity.trim().toLowerCase()]
  if (byName) return byName
  return /^\(([A-Za-z0-9]+)\)$/.exec(rarityCode.trim())?.[1] ?? null
}

// English codes say where the print was made: LOB-EN001, LOB-E001 (Europe), LOB-A001
// (Australia), SDK-001 (the first North American prints, no letters).
const ENGLISH_CODE_REGION: Record<string, string> = { EN: 'EN', E: 'EU', A: 'AU', '': 'NA' }

function regionsFor(setCode: string, language: Language): string[] {
  const regions = REGIONS[language] ?? []
  if (language !== 'en') return regions
  const letters = /-([A-Z]*)\d/i.exec(setCode)?.[1]?.toUpperCase()
  const hint = letters === undefined ? undefined : ENGLISH_CODE_REGION[letters]
  return hint ? [hint, ...regions.filter((r) => r !== hint)] : regions
}

const EDITIONS = ['1E', 'UE', 'LE', 'DT']
// <Card>-<SETPREFIX>-<REGION>-<RARITY>[-<EDITION>][-<variant>].<ext>
const FILE_RE = /^[^-]+-([A-Za-z0-9]+)-([A-Z]{2})-([A-Za-z0-9]+)(?:-([^.]+))?\.(?:png|jpe?g|gif|webp)$/i

export interface PrintingKey {
  setCode: string
  language: Language
  rarity: string
  rarityCode?: string
}

/**
 * Picks the Yugipedia scan for a printing from the files on its card's gallery page: same set
 * prefix and region (preferred regions first), the printing's rarity when one exists, then the
 * plainest file (no alternate-art or special-edition suffix). Null when nothing matches.
 */
export function choosePrintingFile(files: string[], p: PrintingKey): string | null {
  const prefix = p.setCode.split('-')[0].toUpperCase()
  const regions = regionsFor(p.setCode, p.language)
  const wanted = rarityAbbr(p.rarity, p.rarityCode)
  const candidates = files.flatMap((file) => {
    const m = FILE_RE.exec(file.replace(/^File:/, ''))
    if (!m || m[1].toUpperCase() !== prefix) return []
    const region = regions.indexOf(m[2].toUpperCase())
    if (region < 0) return []
    const rest = (m[4] ?? '').split('-').filter(Boolean)
    const edition = rest.length > 0 && EDITIONS.includes(rest[0].toUpperCase()) ? rest.shift() : undefined
    return [{ file: file.replace(/^File:/, ''), region, rarity: m[3], edition, extra: rest.length }]
  })
  if (candidates.length === 0) return null
  const sameRarity = wanted ? candidates.filter((c) => c.rarity.toLowerCase() === wanted.toLowerCase()) : []
  const pool = sameRarity.length > 0 ? sameRarity : candidates
  const editionRank = (e: string | undefined): number =>
    e === undefined ? 0 : EDITIONS.indexOf(e.toUpperCase()) + 1
  pool.sort(
    (a, b) =>
      a.extra - b.extra ||
      a.region - b.region ||
      editionRank(a.edition) - editionRank(b.edition) ||
      a.file.localeCompare(b.file)
  )
  return pool[0].file
}
