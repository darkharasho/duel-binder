import { getJson, type GetJsonOpts } from './http'
import type { PkmLang, TdCard, TdSet } from './types'

const BASE = 'https://api.tcgdex.net/v2'

export const tcgdexSetList = (lang: PkmLang, o: GetJsonOpts): Promise<{ id: string }[]> =>
  getJson(`${BASE}/${lang}/sets`, o)

export const tcgdexSet = (lang: PkmLang, id: string, o: GetJsonOpts): Promise<TdSet> =>
  getJson(`${BASE}/${lang}/sets/${encodeURIComponent(id)}`, o)

export const tcgdexCard = (lang: PkmLang, id: string, o: GetJsonOpts): Promise<TdCard> =>
  getJson(`${BASE}/${lang}/cards/${encodeURIComponent(id)}`, o)
