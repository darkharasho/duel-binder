/**
 * Affiliate "buy" links to TCGplayer (through Impact) and eBay (through the eBay Partner Network).
 * The ids are public: they appear in every link. A blank id hides that store's link.
 */
import type { GameId } from './games/types'
import { languageInfo, type Language } from './languages'

export const AFFILIATE = {
  /** eBay Partner Network campaign id ("campid"). */
  ebayCampaignId: '5339251706',
  /** The Impact tracking link TCGplayer gives an affiliate; the target goes in its `u` parameter. */
  tcgplayerImpactBase: ''
}
export type AffiliateIds = typeof AFFILIATE

/** True when any store's link can show. */
export const affiliateOn = (ids: AffiliateIds = AFFILIATE): boolean =>
  ids.ebayCampaignId !== '' || ids.tcgplayerImpactBase !== ''

export interface BuyTarget {
  game: GameId
  name: string
  setCode: string
  setRarity: string
  language: Language
  tcgProductId?: number | null
}

export type BuyStore = 'tcgplayer' | 'ebay'
export interface BuyLink {
  store: BuyStore
  label: string
  url: string
}

const TCGPLAYER_LINE: Record<GameId, string> = {
  ygo: 'yugioh',
  pkm: 'pokemon',
  mtg: 'magic',
  op: 'one-piece-card-game'
}

const words = (...parts: string[]): string =>
  parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' ')

/** TCGplayer page for the printing: its product, else a search for English printings; else null. */
export function tcgplayerUrl(t: BuyTarget, ids: AffiliateIds = AFFILIATE): string | null {
  if (!ids.tcgplayerImpactBase) return null
  let target: string
  if (t.tcgProductId) target = `https://www.tcgplayer.com/product/${t.tcgProductId}`
  else if (t.language === 'en')
    target = `https://www.tcgplayer.com/search/${TCGPLAYER_LINE[t.game]}/product?q=${encodeURIComponent(words(t.name, t.setCode))}`
  else return null
  return `${ids.tcgplayerImpactBase}?u=${encodeURIComponent(target)}`
}

// A Manga-Style tone, as the app names it after the rarity: "Ultra Rare (Manga-Style, Color)".
// Sellers spell tones too many ways to search by (as in the eBay price worker's buildQuery).
const TONED_RARITY = /^(.*?)\s*\([^()]*,\s*(color|monochrome)\)\s*$/i

/**
 * The rarity words sellers write. Yu-Gi-Oh! rarities are theirs already. A Pokémon "rarity" is a
 * finish ("Normal", "Holofoil"), of which only Reverse Holo and 1st Edition appear in titles.
 * One Piece and Magic codes ("SR (Alternate Art)", "Rare (Foil)") only narrow a search.
 */
function sellerRarity(t: BuyTarget): string {
  if (t.game === 'ygo') return TONED_RARITY.exec(t.setRarity)?.[1] ?? t.setRarity
  if (t.game !== 'pkm') return ''
  return words(
    /1st edition/i.test(t.setRarity) ? '1st Edition' : '',
    /reverse/i.test(t.setRarity) ? 'Reverse Holo' : ''
  )
}

/** eBay search for the printing: name, set code, seller rarity words and, off English, the language. */
export function ebayUrl(t: BuyTarget, ids: AffiliateIds = AFFILIATE): string | null {
  if (!ids.ebayCampaignId) return null
  const rarity = sellerRarity(t)
  const language = t.language === 'en' ? '' : languageInfo(t.language).ebayWord
  const q = words(t.name, t.setCode, rarity, language)
  return (
    `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}` +
    `&mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid=${encodeURIComponent(ids.ebayCampaignId)}` +
    `&toolid=10001&mkevt=1`
  )
}

/** The printing's buy links, TCGplayer first; empty when no store's id is set. */
export function buyLinks(t: BuyTarget, ids: AffiliateIds = AFFILIATE): BuyLink[] {
  const links: BuyLink[] = []
  const tcg = tcgplayerUrl(t, ids)
  if (tcg) links.push({ store: 'tcgplayer', label: 'Buy on TCGplayer', url: tcg })
  const ebay = ebayUrl(t, ids)
  if (ebay) links.push({ store: 'ebay', label: 'Buy on eBay', url: ebay })
  return links
}
