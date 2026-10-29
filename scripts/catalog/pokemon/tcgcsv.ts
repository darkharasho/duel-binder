import { getJson, type GetJsonOpts } from './http'
import type { PkmLang, TcGroup, TcPrice, TcProduct } from './types'

const CATEGORY: Record<PkmLang, number> = { en: 3, ja: 85 }
const base = (lang: PkmLang): string => `https://tcgcsv.com/tcgplayer/${CATEGORY[lang]}`

interface Envelope<T> { success?: boolean; errors?: unknown[]; results: T[] }

async function results<T>(url: string, o: GetJsonOpts): Promise<T[]> {
  const body = await getJson<Envelope<T>>(url, o)
  if (body.success === false || !Array.isArray(body.results)) {
    throw new Error(`GET ${url} returned an unsuccessful TCGCSV envelope: ${JSON.stringify(body.errors ?? [])}`)
  }
  return body.results
}

export async function tcgcsvGroups(lang: PkmLang, o: GetJsonOpts): Promise<TcGroup[]> {
  const rows = await results<{ groupId: number; name: string; abbreviation?: string | null }>(`${base(lang)}/groups`, o)
  return rows.map((g) => ({ groupId: g.groupId, name: g.name, abbreviation: g.abbreviation ?? null }))
}

export async function tcgcsvProducts(lang: PkmLang, groupId: number, o: GetJsonOpts): Promise<TcProduct[]> {
  const rows = await results<{
    productId: number; groupId: number; name: string; imageUrl?: string
    extendedData?: { name: string; value: string }[]
  }>(`${base(lang)}/${groupId}/products`, o)
  return rows.map((p) => ({
    productId: p.productId, groupId: p.groupId, name: p.name, imageUrl: p.imageUrl,
    number: p.extendedData?.find((e) => e.name === 'Number')?.value ?? null
  }))
}

export async function tcgcsvPrices(lang: PkmLang, groupId: number, o: GetJsonOpts): Promise<TcPrice[]> {
  const rows = await results<{ productId: number; subTypeName: string; marketPrice?: number | null }>(
    `${base(lang)}/${groupId}/prices`, o
  )
  return rows.map((p) => ({ productId: p.productId, subTypeName: p.subTypeName, marketPrice: p.marketPrice ?? null }))
}
