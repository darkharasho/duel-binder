import { getJson, type GetJsonOpts } from '../pokemon/http'
import type { TcGroup, TcPrice } from '../pokemon/types'

const BASE = 'https://tcgcsv.com/tcgplayer/68'

export interface OpProduct {
  productId: number
  groupId: number
  name: string
  number: string | null
  rarity: string | null
  imageUrl: string | null
}

interface Envelope<T> { success?: boolean; errors?: unknown[]; results: T[] }

async function results<T>(url: string, o: GetJsonOpts): Promise<T[]> {
  const body = await getJson<Envelope<T>>(url, o)
  if (body.success === false || !Array.isArray(body.results)) {
    throw new Error(`GET ${url} returned an unsuccessful TCGCSV envelope: ${JSON.stringify(body.errors ?? [])}`)
  }
  return body.results
}

export async function opGroups(o: GetJsonOpts): Promise<TcGroup[]> {
  const rows = await results<{ groupId: number; name: string; abbreviation?: string | null; publishedOn?: string }>(`${BASE}/groups`, o)
  return rows.map((g) => ({ groupId: g.groupId, name: g.name, abbreviation: g.abbreviation ?? null, publishedOn: g.publishedOn }))
}

export async function opProducts(groupId: number, o: GetJsonOpts): Promise<OpProduct[]> {
  const rows = await results<{
    productId: number; groupId: number; name: string; imageUrl?: string; imageCount?: number
    extendedData?: { name: string; value: string }[]
  }>(`${BASE}/${groupId}/products`, o)
  return rows.map((p) => {
    const field = (n: string): string | null => p.extendedData?.find((e) => e.name === n)?.value ?? null
    return {
      productId: p.productId, groupId: p.groupId, name: p.name, number: field('Number'), rarity: field('Rarity'),
      // A presale single has a URL before it has a picture; imageCount 0 says it would 403.
      imageUrl: p.imageCount === 0 ? null : p.imageUrl ?? null
    }
  })
}

export async function opPrices(groupId: number, o: GetJsonOpts): Promise<TcPrice[]> {
  const rows = await results<{ productId: number; subTypeName: string; marketPrice?: number | null }>(`${BASE}/${groupId}/prices`, o)
  return rows.map((p) => ({ productId: p.productId, subTypeName: p.subTypeName, marketPrice: p.marketPrice ?? null }))
}
