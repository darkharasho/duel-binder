import { getJson, type GetJsonOpts } from './http'
import type { TdLang, TdCard, TdSet } from './types'

const BASE = 'https://api.tcgdex.net/v2'

export const tcgdexSetList = (lang: TdLang, o: GetJsonOpts): Promise<{ id: string }[]> =>
  getJson(`${BASE}/${lang}/sets`, o)

export const tcgdexSet = (lang: TdLang, id: string, o: GetJsonOpts): Promise<TdSet> =>
  getJson(`${BASE}/${lang}/sets/${encodeURIComponent(id)}`, o)

export const tcgdexCard = (lang: TdLang, id: string, o: GetJsonOpts): Promise<TdCard> =>
  getJson(`${BASE}/${lang}/cards/${encodeURIComponent(id)}`, o)
