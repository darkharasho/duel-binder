import type { Language } from '@shared/languages'

export interface SetListRow {
  code: string
  name: string
  rarities: string[]
  /** The row's art variant from `// description::(...)`, e.g. "Overframe"; absent for the plain card. */
  variant?: string
}
export interface ParsedSetList {
  setPage: string | null
  rows: SetListRow[]
}
export interface Infobox {
  image: string | null
  dates: Record<string, string>
}

const RARITIES: Record<string, string> = {
  C: 'Common',
  R: 'Rare',
  SR: 'Super Rare',
  UR: 'Ultra Rare',
  ScR: 'Secret Rare',
  UtR: 'Ultimate Rare',
  GR: 'Ghost Rare',
  HFR: 'Holofoil Rare',
  PScR: 'Prismatic Secret Rare',
  QCScR: 'Quarter Century Secret Rare',
  CR: "Collector's Rare",
  SPR: 'Short Print',
  SSP: 'Super Short Print',
  NR: 'Normal Rare',
  GUR: 'Gold Rare',
  PlR: 'Platinum Rare',
  StR: 'Starlight Rare',
  '10000ScR': '10000 Secret Rare',
  // Checked against Yugipedia's abbreviation redirects. "MR" is not here: on Yugipedia it is
  // Magic Ruler, the set; Millennium Rare is "MLR".
  MLR: 'Millennium Rare',
  GMR: 'Grand Master Rare',
  NPR: 'Normal Parallel Rare',
  UPR: 'Ultra Parallel Rare',
  ScPR: 'Secret Parallel Rare',
  EScR: 'Extra Secret Rare',
  HGR: 'Holographic Rare',
  GScR: 'Gold Secret Rare',
  PGR: 'Premium Gold Rare',
  SFR: 'Starfoil Rare',
  SHR: 'Shatterfoil Rare',
  KCR: 'Kaiba Corporation Rare'
}

export function normalizeRarity(raw: string): string {
  return Object.hasOwn(RARITIES, raw) ? RARITIES[raw] : raw
}

function splitRarities(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => normalizeRarity(s.trim()))
    .filter((s) => s !== '')
}

/**
 * The variant a row's `// description::(...)` note names. Yugipedia's "extended art" is the card art
 * running over the frame: an overframe, as the English TCGplayer variants are labelled.
 */
function variantFromComment(comment: string): string | undefined {
  const m = /description::\s*\(?([^()]*?)\)?\s*$/.exec(comment)
  const note = m?.[1].trim()
  if (!note) return undefined
  if (/^extended art$/i.test(note)) return 'Overframe'
  return note[0].toUpperCase() + note.slice(1)
}

export function parseSetList(wikitext: string): ParsedSetList | null {
  const lines = wikitext.split(/\r?\n/)
  const rows: SetListRow[] = []
  let found = false
  let i = 0
  while (i < lines.length) {
    const open = lines[i].indexOf('{{Set list|')
    if (open === -1) {
      i++
      continue
    }
    found = true
    const header = lines[i].slice(open + '{{Set list|'.length)
    const params = new Map<string, string>()
    for (const part of header.split('|')) {
      const eq = part.indexOf('=')
      if (eq > 0) params.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim())
    }
    const noCode =
      params
        .get('options')
        ?.split(',')
        .map((s) => s.trim())
        .includes('noabbr') ?? false
    const fallback = splitRarities(params.get('rarities'))
    i++
    for (; i < lines.length; i++) {
      let line = lines[i].trim()
      let closes = false
      if (line.startsWith('}}')) {
        i++
        break
      }
      if (line === '' || line.startsWith('<!--')) continue
      if (line.endsWith('}}')) {
        closes = true
        line = line.slice(0, -2)
      }
      const slash = line.indexOf('//')
      const variant = slash === -1 ? undefined : variantFromComment(line.slice(slash + 2))
      if (slash !== -1) line = line.slice(0, slash)
      line = line.trim()
      if (line !== '') {
        const fields = line.split(';').map((s) => s.trim())
        const code = noCode ? '' : (fields.shift() ?? '')
        const name = fields[0] ?? ''
        if (name !== '') {
          const own = splitRarities(fields[1])
          const rarities = own.length ? own : fallback.length ? fallback : ['Common']
          rows.push(variant ? { code, name, rarities, variant } : { code, name, rarities })
        }
      }
      if (closes) {
        i++
        break
      }
    }
  }
  if (!found) return null
  const page = /\{\{Set page header\s*\|\s*set\s*=\s*([^|}\n]+)/.exec(wikitext)
  return { setPage: page ? page[1].trim() : null, rows }
}

export function listTitleParts(title: string): { setName: string; suffix: string } | null {
  const m = /^Set Card Lists:(.+) \(([^()]+)\)$/.exec(title)
  return m ? { setName: m[1], suffix: m[2] } : null
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december'
]

export function parseReleaseDate(raw: string): string | null {
  const m = /^\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s*$/.exec(raw)
  if (!m) return null
  const month = MONTHS.indexOf(m[1].toLowerCase()) + 1
  if (month === 0) return null
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

export function parseInfobox(wikitext: string): Infobox | null {
  const start = wikitext.indexOf('{{Infobox set')
  if (start === -1) return null
  const dates: Record<string, string> = {}
  let image: string | null = null
  for (const line of wikitext.slice(start).split(/\r?\n/).slice(1)) {
    if (line.startsWith('}}')) break
    const m = /^\|\s*([^=|]+?)\s*=\s*(.*?)\s*$/.exec(line)
    if (!m) continue
    if (m[1] === 'image') image = m[2] === '' ? null : m[2]
    else if (m[1].endsWith('_release_date')) {
      const d = parseReleaseDate(m[2])
      if (d) dates[m[1]] = d
    }
  }
  return { image, dates }
}

const DATE_FIELDS: Record<Language, string[]> = {
  en: [],
  ja: ['jp_release_date'],
  ko: ['kr_release_date'],
  de: ['de_release_date', 'fr/de/it/sp_release_date', 'eu_release_date'],
  fr: ['fr_release_date', 'fr/de/it/sp_release_date', 'eu_release_date'],
  it: ['it_release_date', 'fr/de/it/sp_release_date', 'eu_release_date'],
  es: ['sp_release_date', 'fr/de/it/sp_release_date', 'eu_release_date'],
  pt: ['pt_release_date', 'eu_release_date'],
  'zh-hans': ['sc_release_date'],
  'zh-hant': ['tc_release_date'],
  ae: ['ae_release_date'],
  'ja-asia': ['ja_release_date']
}

export function releaseDateFor(box: Infobox, language: Language): string | null {
  for (const f of DATE_FIELDS[language]) if (box.dates[f]) return box.dates[f]
  return null
}
