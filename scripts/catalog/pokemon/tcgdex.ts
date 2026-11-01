import { getJson, type GetJsonOpts } from './http'
import type { EuropeanLang, TdLang, TdCard, TdSet } from './types'

const BASE = 'https://api.tcgdex.net/v2'

/** TCGdex's own language codes; Traditional Chinese is `zh-tw` there. */
export type TcgdexLang = TdLang | EuropeanLang | 'zh-tw'

export const tcgdexSetList = (lang: TcgdexLang, o: GetJsonOpts): Promise<{ id: string }[]> =>
  getJson(`${BASE}/${lang}/sets`, o)

export const tcgdexSet = (lang: TcgdexLang, id: string, o: GetJsonOpts): Promise<TdSet> =>
  getJson(`${BASE}/${lang}/sets/${encodeURIComponent(id)}`, o)

export const tcgdexCard = (lang: TcgdexLang, id: string, o: GetJsonOpts): Promise<TdCard> =>
  getJson(`${BASE}/${lang}/cards/${encodeURIComponent(id)}`, o)
