import { BANDAI_ID_RE } from '../../../src/shared/imageSources'
import type { BandaiEntry, BandaiSeries } from './types'

export const BANDAI_EN = 'https://en.onepiece-cardgame.com'
/** Bandai's Japanese card list: the same page layout, in Japanese. */
export const BANDAI_JA = 'https://www.onepiece-cardgame.com'
export { BANDAI_ID_RE } from '../../../src/shared/imageSources'

// Regex parsing on purpose: the job bundle runs under Electron, with no DOM library.

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
  ndash: '–',
  mdash: '—'
}

function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));/g, (m, dec, hex, name) => {
    if (name) return NAMED[name] ?? m
    const code = dec ? parseInt(dec, 10) : parseInt(hex, 16)
    try {
      return String.fromCodePoint(code)
    } catch {
      return m
    }
  })
}

const BREAK = '\u0000'

/** Tags stripped, entities decoded, whitespace collapsed. With `keepBreaks`, `<br>` becomes `\n`. */
function text(html: string, keepBreaks = false): string {
  let s = html.replace(/<br\s*\/?>/gi, keepBreaks ? BREAK : ' ')
  s = decodeEntities(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ')
  if (keepBreaks) s = s.split(BREAK).map((p) => p.trim()).join('\n')
  return s.trim()
}

function num(s: string | null): number | null {
  if (s === null) return null
  const v = s.trim().replace(/^\+/, '')
  return /^\d+$/.test(v) ? parseInt(v, 10) : null
}

function list(s: string | null): string[] {
  if (!s || s === '-') return []
  return s.split('/').map((p) => p.trim()).filter((p) => p && p !== '-')
}

// ---------------------------------------------------------------- series list

const SERIES_RE = /^(.*?)\s*-(.+)-\s*\[([^\]]+)\]$/
/** The Japanese site's `ブースターパック 世界最強の戦士【OP-17】`: kind, title, code in full-width brackets. */
const JA_SERIES_RE = /^(\S+)\s+(.+?)\s*【([^】]+)】$/

const SPECIAL: Record<string, BandaiSeries> = {
  '569901': { id: '569901', kind: 'promo', title: 'Promotion Cards', code: 'P', setName: 'Promotion Cards', setCode: 'P' },
  '569801': { id: '569801', kind: 'other', title: 'Other Product Cards', code: 'OPC', setName: 'Other Product Cards', setCode: 'OPC' },
  // The Japanese site's pages of the same kinds, and its Family Deck Set (which has no code).
  '550901': { id: '550901', kind: 'promo', title: 'Promotion Cards', code: 'P', setName: 'Promotion Cards', setCode: 'P' },
  '550801': { id: '550801', kind: 'other', title: 'Other Product Cards', code: 'OPC', setName: 'Other Product Cards', setCode: 'OPC' },
  '550701': { id: '550701', kind: 'deck', title: 'Family Deck Set', code: 'FDS', setName: 'Family Deck Set', setCode: 'FDS' }
}

/** `OP-17` -> `OP17`; `OP15-EB04` stays as it is. */
function setCodeOf(code: string): string {
  const m = /^([A-Z]+)-([0-9]+)$/.exec(code)
  return m ? m[1] + m[2] : code
}

export function parseSeriesList(html: string): { series: BandaiSeries[]; notes: string[] } {
  const series: BandaiSeries[] = []
  const notes: string[] = []
  const select = /<select[^>]*id="series"[^>]*>([\s\S]*?)<\/select>/i.exec(html)
  if (!select) return { series, notes }
  for (const m of select[1].matchAll(/<option\s+value="(\d+)"[^>]*>([\s\S]*?)<\/option>/gi)) {
    const id = m[1]
    if (SPECIAL[id]) {
      series.push({ ...SPECIAL[id] })
      continue
    }
    const label = text(decodeEntities(m[2]))
    const p = SERIES_RE.exec(label) ?? JA_SERIES_RE.exec(label)
    if (!p) {
      notes.push(`${id}: unreadable series "${label}", skipped`)
      continue
    }
    const head = p[1].trim()
    const title = p[2].trim()
    const code = p[3].trim()
    let kind: BandaiSeries['kind']
    if (/BOOSTER|ブースター/i.test(head)) kind = 'booster'
    else if (/DECK|デッキ/i.test(head)) kind = 'deck'
    else {
      kind = 'booster'
      notes.push(`${id}: unknown series kind "${head}", read as a booster`)
    }
    series.push({ id, kind, title, code, setName: `${title} [${code}]`, setCode: setCodeOf(code) })
  }
  return { series, notes }
}

// ------------------------------------------------------------------ card list

/** The inner HTML of `<div class="cls">`, minus its leading `<h3>` label; null when absent. */
function field(block: string, cls: string): string | null {
  const m = new RegExp(`<div class="${cls}">([\\s\\S]*?)</div>`).exec(block)
  return m ? m[1].replace(/<h3>[\s\S]*?<\/h3>/, '') : null
}

function plain(block: string, cls: string): string | null {
  const f = field(block, cls)
  if (f === null) return null
  const t = text(f)
  return t === '' || t === '-' ? null : t
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase())
}

/** The Japanese site's card types, by how they start (one entry reads キャラクタークター). */
const JA_TYPES: [string, string][] = [
  ['キャラ', 'Character'],
  ['リーダー', 'Leader'],
  ['イベント', 'Event'],
  ['ステージ', 'Stage']
]
function cardTypeOf(raw: string): string {
  const ja = JA_TYPES.find(([prefix]) => raw.startsWith(prefix))
  return ja ? ja[1] : titleCase(raw)
}

/** The Japanese site's colors and attributes in the English words; anything else stays as it is. */
const JA_COLORS: Record<string, string> = { 赤: 'Red', 緑: 'Green', 青: 'Blue', 紫: 'Purple', 黒: 'Black', 黄: 'Yellow' }
const JA_ATTRIBUTES: Record<string, string> = { 打: 'Strike', 斬: 'Slash', 射: 'Ranged', 特: 'Special', 知: 'Wisdom' }

export function parseCardList(html: string, seriesId: string): { entries: BandaiEntry[]; skipped: string[] } {
  const entries: BandaiEntry[] = []
  const skipped: string[] = []
  for (const m of html.matchAll(/<dl class="modalCol" id="([^"]*)">([\s\S]*?)<\/dl>/g)) {
    const id = decodeEntities(m[1]).trim()
    const block = m[2]
    const info = /<div class="infoCol">([\s\S]*?)<\/div>/.exec(block)
    const spans = info ? [...info[1].matchAll(/<span>([\s\S]*?)<\/span>/g)].map((s) => text(s[1])) : []
    const name = text(/<div class="cardName">([\s\S]*?)<\/div>/.exec(block)?.[1] ?? '')
    if (!BANDAI_ID_RE.test(id) || !name) {
      skipped.push(id)
      continue
    }
    const costHtml = field(block, 'cost')
    const isLife = /<div class="cost"><h3>\s*(?:Life|ライフ)\s*<\/h3>/i.test(block)
    const costVal = costHtml === null ? null : num(text(costHtml))
    const rarity = spans[1] ?? ''
    const attrHtml = field(block, 'attribute')
    // English pages name the attribute in <i>; Japanese ones only in the icon's alt (`打/特`).
    const named = attrHtml ? [...attrHtml.matchAll(/<i>([\s\S]*?)<\/i>/g)].map((a) => text(a[1])).filter(Boolean) : []
    const alts = attrHtml && named.length === 0 ? [...attrHtml.matchAll(/<img[^>]*\balt="([^"]*)"/g)].map((a) => text(a[1])) : []
    const attribute = list([...named, ...alts].join('/')).map((a) => JA_ATTRIBUTES[a] ?? a)
    entries.push({
      bandaiId: id,
      number: spans[0] ?? '',
      rarity: rarity === 'SP CARD' || rarity === 'SPカード' ? 'SP' : rarity,
      cardType: cardTypeOf(spans[2] ?? ''),
      name,
      cost: isLife ? null : costVal,
      life: isLife ? costVal : null,
      power: num(plain(block, 'power')),
      counter: num(plain(block, 'counter')),
      colors: list(plain(block, 'color')).map((c) => JA_COLORS[c] ?? c),
      attribute,
      traits: list(plain(block, 'feature')),
      block: num(plain(block, 'block')),
      effect: textOrNull(field(block, 'text')),
      trigger: textOrNull(field(block, 'trigger')),
      cardSets: cardSetsOf(block),
      seriesId
    })
  }
  return { entries, skipped }
}

/** The card sets line. The Japanese site follows it with its own links, which are left out. */
function cardSetsOf(block: string): string {
  const f = field(block, 'getInfo')
  if (f === null) return ''
  const t = text(f.replace(/<div class="getInfoBtnCol">[\s\S]*$/, ''))
  return t === '-' ? '' : t
}

function textOrNull(html: string | null): string | null {
  if (html === null) return null
  const t = text(html, true)
  return t === '' || t === '-' ? null : t
}
