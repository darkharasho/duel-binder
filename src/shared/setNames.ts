import { EUROPEAN_SET_NAMES } from './europeanSetNames'

/**
 * Set names as the app shows them. English is the app's language, so a set the catalog names in
 * another script shows its English name. Display only: the catalog's `set_name` stays the key
 * (it is part of every non-English printing's key), so filters, IPC calls and sync keep using it.
 */

/**
 * English names of the catalog's Japanese Pokémon sets whose TCGplayer Japan group the catalog job
 * could not match, so they kept TCGdex's Japanese name (matched ones are already named after the
 * group). The names are the TCGplayer Japan group names, without their "{code}: " prefix. Keyed by
 * the catalog's set name, which is frozen once written.
 */
const ENGLISH_SET_NAMES: Readonly<Record<string, string>> = {
  '金、銀、新世界へ...': 'Gold, Silver, to a New World...',
  '遺跡をこえて...': 'Crossing the Ruins...',
  めざめる伝説: 'Awakening Legends',
  '闇、そして光へ...': 'Darkness, and to Light...',
  'ポケモンカード★VS': 'Pokemon VS',
  'ポケモンカード★web': 'Pokemon Web',
  基本拡張パック: 'Base Expansion Pack',
  地図にない町: 'The Town on No Map',
  海からの風: 'Wind from the Sea',
  裂けた大地: 'Split Earth',
  神秘なる山: 'Mysterious Mountains',
  拡張パック: 'ADV Expansion Pack',
  砂漠のきせき: 'Miracle of the Desert',
  天空の覇者: 'Rulers of the Heavens',
  '強化拡張パックex1マグマVSアクア ふたつの野望': 'Magma VS Aqua: Two Ambitions',
  とかれた封印: 'Undone Seal',
  伝説の飛翔: 'Flight of Legends',
  蒼空の激突: 'Clash of the Blue Sky',
  ロケット団の逆襲: 'Rocket Gang Strikes Back',
  '金の空、銀の海': 'Golden Sky, Silvery Ocean',
  まぼろしの森: 'Mirage Forest',
  ホロンの研究塔: 'Holon Research Tower',
  ホロンの幻影: 'Holon Phantom',
  きせきの結晶: 'Miracle Crystal',
  さいはての攻防: 'Offense and Defense of the Furthest Ends',
  ワールドチャンピオンズパック: 'World Champions Pack',
  ソウルシルバーコレクション: 'SoulSilver Collection',
  ハートゴールドコレクション: 'HeartGold Collection',
  よみがえる伝説: 'Revival Legends',
  コレクションX: 'Collection X',
  コレクションY: 'Collection Y',
  ガイアボルケーノ: 'Gaia Volcano',
  タイダルストーム: 'Tidal Storm',
  赤い閃光: 'Red Flash',
  青い衝撃: 'Blue Shock',
  冷酷の反逆者: 'Cruel Traitor',
  爆熱の闘士: 'Fever-Burst Fighter',
  'サン＆ムーン': 'Sun & Moon',
  新たなる試練の向こう: 'Facing a New Trial',
  ひかる伝説: 'Shining Legends',
  GXバトルブースト: 'GX Battle Boost',
  ウルトラフォース: 'Ultra Force',
  トリプレットビート: 'Triplet Beat',
  'スターターセット テラスタイプ：ステラ ソウブレイズex':
    'Ceruledge ex Stellar Tera Type Starter Set',
  'スタートデッキ100 バトルコレクション': 'Start Deck 100 Battle Collection'
}

/** Japanese kana and kanji, Chinese hanzi and Korean hangul: scripts an English reader can't read. */
const NATIVE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

/** The " (SM1P)" the catalog job appends when a set's name is already taken. */
const TAKEN_SUFFIX = /^(.+) (\([A-Za-z0-9.+-]+\))$/

/** Whether a name is written (at least partly) in a script other than Latin. */
export function hasNativeScript(name: string): boolean {
  return NATIVE_SCRIPT.test(name)
}

/**
 * The name the app shows for a set: its English name when the catalog's name is in another
 * language or script ("GXバトルブースト" → "GX Battle Boost", "トリプレットビート (CS1A)" → "Triplet Beat
 * (CS1A)"); else, for a name with no known English name, the set's code (the part of `code` before
 * any space, so a printing's "SM4P 121/114" gives "SM4P"); else the name as it is.
 */
export function englishSetName(name: string, code?: string | null): string {
  const known = ENGLISH_SET_NAMES[name] ?? EUROPEAN_SET_NAMES[name]
  if (known) return known
  if (!hasNativeScript(name)) return name
  const taken = TAKEN_SUFFIX.exec(name)
  const base = taken ? ENGLISH_SET_NAMES[taken[1]] : undefined
  if (base) return `${base} ${taken![2]}`
  const prefix = code?.trim().split(/\s+/)[0]
  return prefix || name
}

/** The catalog's own name when the app shows another (for a tooltip or subtitle), else null. */
export function nativeSetName(name: string, code?: string | null): string | null {
  return englishSetName(name, code) === name ? null : name
}

/** A tooltip for a set's shown name: the shown name, then the catalog's own when it differs. */
export function setNameTooltip(name: string, code?: string | null): string {
  const shown = englishSetName(name, code)
  return shown === name ? name : `${shown} (${name})`
}
