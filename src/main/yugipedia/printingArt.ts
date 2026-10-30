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
  'grand master rare': 'GMR',
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
const FILE_RE =
  /^[^-]+-([A-Za-z0-9]+)-([A-Z]{2})-([A-Za-z0-9]+)(?:-([^.]+))?\.(?:png|jpe?g|gif|webp)$/i

export interface PrintingKey {
  /** The printing's code, or just the set prefix ("YAC1") for an uncoded printing. */
  setCode: string
  language: Language
  /** As stored; an art variant may be part of it, as in "Ultra Rare (Overframe)". */
  rarity: string
  rarityCode?: string
  /** card_printings.variant, e.g. "Overframe" or "Manga-Style". */
  variant?: string | null
}

/** File-name suffixes Yugipedia uses for an art variant, by variant name (lower case). */
const VARIANT_SUFFIX: Record<string, string> = { overframe: 'EA' }
const suffixKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const variantSuffix = (variant: string): string =>
  suffixKey(VARIANT_SUFFIX[variant.toLowerCase()] ?? variant)

/** "Ultra Rare (Overframe)" to its rarity and variant; the variant column wins when set. */
function splitVariant(p: PrintingKey): { rarity: string; variant: string | null } {
  if (p.variant) return { rarity: p.rarity, variant: p.variant }
  const m = /^(.+?)\s*\(([^()]+)\)$/.exec(p.rarity.trim())
  if (m && rarityAbbr(m[1])) return { rarity: m[1], variant: m[2] }
  return { rarity: p.rarity, variant: null }
}

/** Variants whose scans carry no suffix: a New artwork printing's file is named like a plain one. */
const UNSUFFIXED_VARIANT = /^new art(work)?$/i

/**
 * Whether a scan (as choosePrintingFile names it) shows the printing's art variant: its file is
 * named with the variant, or the printing has none, or its variant's scans carry no suffix, or
 * (with `onlyVariantOfRarity`: its code has no plain printing of its rarity) the file is its own
 * rarity's with no variant named, as Yugipedia names LOCR's all-overframe Prismatic Secret Rares.
 * False for the plain file an overframe or Manga-Style printing with no scan of its own fell back
 * to.
 */
export function fileShowsVariant(
  file: string,
  p: PrintingKey,
  onlyVariantOfRarity = false
): boolean {
  const { rarity, variant } = splitVariant(p)
  if (!variant || UNSUFFIXED_VARIANT.test(variant.trim())) return true
  const m = FILE_RE.exec(file.replace(/^File:/, ''))
  if (!m) return false
  const rest = (m[4] ?? '').split('-').filter(Boolean)
  if (rest.length > 0 && EDITIONS.includes(rest[0].toUpperCase())) rest.shift()
  const keys = rest.map(suffixKey)
  if (keys.includes(variantSuffix(variant))) return true
  const wanted = rarityAbbr(rarity, p.rarityCode)
  return (
    onlyVariantOfRarity &&
    keys.length === 0 &&
    !!wanted &&
    m[3].toLowerCase() === wanted.toLowerCase()
  )
}

/**
 * Picks the Yugipedia scan for a printing from the files on its card's gallery page: same set
 * prefix and region (preferred regions first), the printing's rarity when one exists, then the
 * plainest file (no alternate-art or special-edition suffix). Null when nothing matches.
 */
export function choosePrintingFile(files: string[], p: PrintingKey): string | null {
  const prefix = p.setCode.split('-')[0].toUpperCase()
  const regions = regionsFor(p.setCode, p.language)
  const { rarity, variant } = splitVariant(p)
  const wanted = rarityAbbr(rarity, p.rarityCode)
  const want = variant ? variantSuffix(variant) : null
  const candidates = files.flatMap((file) => {
    const m = FILE_RE.exec(file.replace(/^File:/, ''))
    if (!m || m[1].toUpperCase() !== prefix) return []
    const region = regions.indexOf(m[2].toUpperCase())
    if (region < 0) return []
    const rest = (m[4] ?? '').split('-').filter(Boolean)
    const edition =
      rest.length > 0 && EDITIONS.includes(rest[0].toUpperCase()) ? rest.shift() : undefined
    const keys = rest.map(suffixKey)
    return [
      {
        file: file.replace(/^File:/, ''),
        region,
        rarity: m[3],
        edition,
        extra: rest.length,
        // 0 when the file shows the printing's variant (or the printing has none), else 1.
        variantMiss: want && !keys.includes(want) ? 1 : 0,
        // Manga-Style comes in colour and monochrome; colour first.
        mono: keys.includes('monochrome') ? 1 : 0
      }
    ]
  })
  if (candidates.length === 0) return null
  const sameRarity = wanted
    ? candidates.filter((c) => c.rarity.toLowerCase() === wanted.toLowerCase())
    : []
  const pool = sameRarity.length > 0 ? sameRarity : candidates
  const editionRank = (e: string | undefined): number =>
    e === undefined ? 0 : EDITIONS.indexOf(e.toUpperCase()) + 1
  pool.sort(
    (a, b) =>
      a.variantMiss - b.variantMiss ||
      a.mono - b.mono ||
      a.extra - b.extra ||
      a.region - b.region ||
      editionRank(a.edition) - editionRank(b.edition) ||
      a.file.localeCompare(b.file)
  )
  return pool[0].file
}
