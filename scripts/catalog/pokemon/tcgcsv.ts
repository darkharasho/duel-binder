import { getJson, type GetJsonOpts } from './http'
import type { TdLang, TcCardRow, TcGroup, TcPrice, TcProduct } from './types'

const CATEGORY: Record<TdLang, number> = { en: 3, ja: 85 }
const base = (lang: TdLang): string => `https://tcgcsv.com/tcgplayer/${CATEGORY[lang]}`

interface Envelope<T> { success?: boolean; errors?: unknown[]; results: T[] }

async function results<T>(url: string, o: GetJsonOpts): Promise<T[]> {
  const body = await getJson<Envelope<T>>(url, o)
  if (body.success === false || !Array.isArray(body.results)) {
    throw new Error(`GET ${url} returned an unsuccessful TCGCSV envelope: ${JSON.stringify(body.errors ?? [])}`)
  }
  return body.results
}

export async function tcgcsvGroups(lang: TdLang, o: GetJsonOpts): Promise<TcGroup[]> {
  const rows = await results<{ groupId: number; name: string; abbreviation?: string | null; publishedOn?: string }>(`${base(lang)}/groups`, o)
  return rows.map((g) => ({ groupId: g.groupId, name: g.name, abbreviation: g.abbreviation ?? null, publishedOn: g.publishedOn }))
}

export async function tcgcsvProducts(lang: TdLang, groupId: number, o: GetJsonOpts): Promise<TcProduct[]> {
  const rows = await results<{
    productId: number; groupId: number; name: string; imageUrl?: string; imageCount?: number
    extendedData?: { name: string; value: string }[]
  }>(`${base(lang)}/${groupId}/products`, o)
  return rows.map((p) => ({
    // A presale single has a URL before it has a picture; imageCount 0 says it would 403.
    productId: p.productId, groupId: p.groupId, name: p.name, imageUrl: p.imageCount === 0 ? undefined : p.imageUrl,
    number: p.extendedData?.find((e) => e.name === 'Number')?.value ?? null
  }))
}

export async function tcgcsvCardRows(lang: TdLang, groupId: number, o: GetJsonOpts): Promise<TcCardRow[]> {
  const rows = await results<{ productId: number; name: string; extendedData?: { name: string; value: string }[] }>(
    `${base(lang)}/${groupId}/products`, o
  )
  return rows.map((p) => ({
    productId: p.productId, name: p.name,
    details: Object.fromEntries((p.extendedData ?? []).map((e) => [e.name, e.value]))
  }))
}

export async function tcgcsvPrices(lang: TdLang, groupId: number, o: GetJsonOpts): Promise<TcPrice[]> {
  const rows = await results<{ productId: number; subTypeName: string; marketPrice?: number | null }>(
    `${base(lang)}/${groupId}/prices`, o
  )
  return rows.map((p) => ({ productId: p.productId, subTypeName: p.subTypeName, marketPrice: p.marketPrice ?? null }))
}
