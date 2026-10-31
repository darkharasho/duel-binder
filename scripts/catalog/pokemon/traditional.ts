import { hasNativeScript } from '../../../src/shared/setNames'
import { bump, fold, JA_SUFFIXES, majority, speciesByDex } from './englishNames'
import { TRADITIONAL_SET_NAMES } from './traditionalNames'
import type { TdCard, TdSet } from './types'
import { isGenerated } from './versions'

/**
 * Traditional Chinese printings, from TCGdex's `zh-tw` cards. TCGdex has no English name for them,
 * but its Asian sets share one card file per card across languages, so a card of a set Japan also
 * has carries the Japanese card's id. English names come from that card (write.ts), then from what
 * those names teach about the Chinese ones. A card nothing names keeps its set and number: a wrong
 * name is worse than none, and names aren't frozen, so it can be named later. TCGplayer doesn't sell
 * these cards, so they have no prices, and the scanner doesn't read them (see buildFingerprints).
 */

/**
 * Sets left out because TCGdex's cards can't be trusted. Taiwan's promos are numbered apart from
 * Japan's, yet TCGdex lays their names over the Japanese file of that number: SV-P-037 is "伊布"
 * (Eevee) with the Energy category of 基本草エネルギー, and SV-P-002 "新葉喵" (Sprigatito) with
 * Spidops' attacks. No field but the name is the card's.
 */
const BROKEN_SETS = new Set(['SV-P'])

/**
 * The sets worth a row, in English. TCGdex lists sets with no cards under another set's name
 * (fifteen "三連音爆", with Simplified ids): a set row would be frozen on nothing, so they wait for
 * cards. A set the table lacks is named by its id, never in Chinese.
 */
export function traditionalSets(sets: TdSet[]): TdSet[] {
  return sets
    .filter((s) => (s.cards?.length ?? 0) > 0 && !BROKEN_SETS.has(s.id))
    .map((s) => ({ ...s, name: TRADITIONAL_SET_NAMES[s.id] ?? s.id }))
}

/** The Latin mechanics a Chinese name ends in, longest first; JA_SUFFIXES without the kana. */
const TAGS = JA_SUFFIXES.filter(([tag]) => !hasNativeScript(tag))
/** The tags printed only on foils; a generated Normal on one of these is TCGdex's default. */
const FOIL_TAG = /(?:VSTAR|VMAX|V-UNION|V|GX|EX|ex)$/

/**
 * A card as the catalog takes it. "None" is how TCGdex writes no rarity. Most cards here have no
 * rarity for versions.ts to read as foil, so a generated Normal on a V, VMAX, VSTAR, GX or ex is
 * read as Holofoil here. It stays generated, so the card still counts as unverified.
 */
export function traditionalCard(card: TdCard): TdCard {
  const rarity = card.rarity === 'None' ? null : card.rarity
  const foil = FOIL_TAG.test(fold(card.name))
  return {
    ...card,
    rarity,
    variants_detailed: card.variants_detailed?.map((v) =>
      foil && isGenerated(v) && v.type === 'normal' ? { ...v, type: 'holo' } : v
    )
  }
}

/** A name without its mechanics: "妙蛙花VMAX" to "妙蛙花" and " VMAX". */
function untag(name: string): { base: string; tag: string } {
  for (const [ja, en] of TAGS) {
    if (name.length > ja.length && name.endsWith(ja)) {
      return { base: name.slice(0, -ja.length).trim(), tag: en }
    }
  }
  return { base: name, tag: '' }
}

/**
 * The Traditional characters of the names no other route reaches, in Simplified, for comparing with
 * the Simplified list. Not a converter: a character it lacks leaves the name unmatched, so a gap can
 * only lose a name, not give a wrong one.
 */
// prettier-ignore
const SIMPLIFIED: Readonly<Record<string, string>> = Object.fromEntries(
  [
    '爾尔', '寶宝', '魚鱼', '亞亚', '龍龙', '飛飞', '鳥鸟', '機机', '夢梦', '蘭兰', '蔥葱', '藥药', '達达', '傷伤', '瑪玛',
    '靈灵', '輸输', '馴驯', '馬马', '錘锤', '裝装', '頭头', '遊游', '齒齿', '輪轮', '場场', '屬属', '茲兹', '兒儿', '躍跃',
    '獸兽', '戰战', '車车', '紅红', '鴨鸭', '聶聂', '奧奥', '護护', '燒烧', '圍围', '舊旧', '褲裤', '劍剑', '龜龟', '鰓鳃',
    '來来', '隊队', '訓训', '練练', '約约', '搖摇', '歐欧', '蠍蝎', '帶带', '蕪芜', '師师', '獺獭', '雙双', '羅罗', '樹树',
    '鐵铁', '殼壳', '厲厉', '廈厦', '連连', '擊击', '蟲虫', '時时', '獎奖', '學学', '決决', '篤笃', '異异', '賀贺', '勝胜',
    '證证', '軍军', '陳陈', '貝贝', '輝辉', '競竞', '萊莱', '飄飘', '軸轴', '長长', '賽赛', '陽阳', '衝冲', '鉗钳', '萬万',
    '鄧邓', '電电', '腦脑', '滾滚', '銃铳', '蠻蛮', '鱸鲈', '廚厨', '蓋盖', '誘诱', '餌饵', '組组', '補补', '給给', '脫脱',
    '聯联', '職职', '員员', '宮宫', '門门', '輕轻', '礙碍', '渦涡', '龐庞', '繭茧', '葉叶', '與与', '結结', '廣广', '膠胶',
    '鳳凤', '運运', '詛诅', '鏟铲', '風风', '礦矿', '傘伞', '濃浓', '煙烟', '釘钉', '鎮镇', '鈴铃', '鐺铛', '驕骄', '內内',
    '樂乐', '換换', '鏡镜', '氣气', '東东', '過过', '釣钓'
  ].map((p) => [p[0], p[1]])
)

export const toSimplified = (name: string): string => name.replace(/./gu, (c) => SIMPLIFIED[c] ?? c)

/** A basic Energy by its type's character, with or without TCGdex's brackets. */
const BASIC_ENERGY = /^基本【?(.)】?能量$/
const ENERGY_TYPES: Readonly<Record<string, string>> = {
  草: 'Grass',
  火: 'Fire',
  水: 'Water',
  雷: 'Lightning',
  超: 'Psychic',
  鬥: 'Fighting',
  惡: 'Darkness',
  鋼: 'Metal'
}

/** Regional forms: left off, the card would read as the plain species' card. */
const FORMS: readonly [string, string][] = [
  ['阿羅拉', 'Alolan '],
  ['伽勒爾', 'Galarian '],
  ['洗翠', 'Hisuian '],
  ['帕底亞', 'Paldean '],
  ['光輝', 'Radiant ']
]

/** A base name that says more than the species: a form, an owner ("火箭隊的"), a style. */
const NOT_PLAIN = /[的\s·・&＆]/

/** The Japanese card a Traditional Chinese card shares its id with, and that card's English name. */
export interface JapaneseTwin {
  card: TdCard
  name: string
}

/** A Simplified Chinese card the catalog has an English name for. */
export interface SimplifiedName {
  chinese: string
  english: string
  category: string | undefined
}

export type TraditionalNamedBy = 'japanese' | 'pair' | 'simplified' | 'energy' | 'species'

type Named = { name: string; by: TraditionalNamedBy }

export interface TraditionalNamer {
  nameOf(card: TdCard): Named | null
}

const sameList = (a: number[] = [], b: number[] = []): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i])

/** Whether a card and the Japanese card of its id are one card, on everything both of them say. */
function sameCard(zh: TdCard, ja: TdCard): boolean {
  const agree = (a: unknown, b: unknown): boolean => a === undefined || b === undefined || a === b
  return (
    zh.localId === ja.localId &&
    zh.category === ja.category &&
    agree(zh.illustrator, ja.illustrator) &&
    agree(zh.hp, ja.hp) &&
    (!zh.dexId?.length || !ja.dexId?.length || sameList(zh.dexId, ja.dexId))
  )
}

/**
 * A namer over the language's cards, tried in order:
 *  1. "japanese": the Japanese card of the same id, when it is the same card and named in English;
 *  2. "pair": the English name those cards give this exact Chinese name, of this category, when most
 *     agree, or give its base name, with the tag and any regional form put back ("妙蛙花V" from
 *     "妙蛙花" and V);
 *  3. "simplified": the same, from the Simplified cards of this name, character by character;
 *  4. "energy": a basic Energy, by its type;
 *  5. "species": the species of the card's one `dexId`, when the base name is the plain one TCGdex's
 *     cards of that number share, with the tag put back.
 */
export function traditionalNamer(
  cards: TdCard[],
  twins: ReadonlyMap<string, JapaneseTwin>,
  enCards: Iterable<TdCard>,
  simplified: Iterable<SimplifiedName> = []
): TraditionalNamer {
  const species = speciesByDex(enCards)
  const twinName = (card: TdCard): string | null => {
    const twin = twins.get(card.id)
    return twin && sameCard(card, twin.card) && !hasNativeScript(twin.name) ? twin.name : null
  }

  const key = (category: string | undefined, name: string): string => `${category}\u0000${name}`
  const pairCounts = new Map<string, Map<string, number>>()
  const baseDex = new Map<number, Set<string>>()
  for (const c of cards) {
    const name = fold(c.name)
    const en = twinName(c)
    if (en) bump(pairCounts, key(c.category, name), en)
    if (c.category === 'Pokemon' && c.dexId?.length === 1) {
      const bases = baseDex.get(c.dexId[0]) ?? new Set<string>()
      baseDex.set(c.dexId[0], bases.add(untag(name).base))
    }
  }
  const simplifiedCounts = new Map<string, Map<string, number>>()
  for (const s of simplified) bump(simplifiedCounts, key(s.category, fold(s.chinese)), s.english)
  const known = (category: string | undefined, name: string): Named | null => {
    const counts = pairCounts.get(key(category, name))
    const en = counts ? majority(counts) : null
    if (en) return { name: en, by: 'pair' }
    const other = simplifiedCounts.get(key(category, toSimplified(name)))
    const zh = other ? majority(other) : null
    return zh ? { name: zh, by: 'simplified' } : null
  }

  /** A number's plain base name: the one inside all of its others ("九尾" in "阿羅拉九尾"). */
  const plainBase = (dex: number): string | null => {
    const bases = [...(baseDex.get(dex) ?? [])].filter((b) => !NOT_PLAIN.test(b))
    const shortest = bases.reduce<string | null>(
      (a, b) => (a === null || b.length < a.length ? b : a),
      null
    )
    if (!shortest || FORMS.some(([f]) => shortest.startsWith(f))) return null
    return [...(baseDex.get(dex) ?? [])].every((b) => b.includes(shortest)) ? shortest : null
  }

  return {
    nameOf(card) {
      const twin = twinName(card)
      if (twin) return { name: twin, by: 'japanese' }
      const name = fold(card.name)
      const whole = known(card.category, name)
      if (whole) return whole
      const { base, tag } = untag(name)
      const named = known(card.category, base)
      if (named) return { name: named.name + tag, by: named.by }
      for (const [form, en] of FORMS) {
        const rest = base.startsWith(form)
          ? known(card.category, base.slice(form.length).trim())
          : null
        if (rest) return { name: en + rest.name + tag, by: rest.by }
      }
      const energy = ENERGY_TYPES[BASIC_ENERGY.exec(name)?.[1] ?? '']
      if (energy) return { name: `Basic ${energy} Energy`, by: 'energy' }
      const dex = card.category === 'Pokemon' && card.dexId?.length === 1 ? card.dexId[0] : null
      const plain = dex === null ? undefined : species.get(dex)
      if (dex !== null && plain && plainBase(dex) === base)
        return { name: plain + tag, by: 'species' }
      return null
    }
  }
}
