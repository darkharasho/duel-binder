import type { YugipediaClient } from './client'

/**
 * The scan files of each card's gallery, by card name. Yugipedia titles some card pages with a
 * trailing " (card)" ("Card Gallery:Field Power Bonus (card)"), so a gallery missing from the
 * first answer is asked for once more under that title. A card with neither is left out.
 */
export async function listCardGalleries(
  client: Pick<YugipediaClient, 'listPageImages'>,
  names: string[]
): Promise<Map<string, string[]>> {
  const unique = [...new Set(names)]
  const first = await client.listPageImages(unique.map((n) => `Card Gallery:${n}`))
  const out = new Map<string, string[]>()
  const missing: string[] = []
  for (const n of unique) {
    const files = first.get(`Card Gallery:${n}`)
    if (files) out.set(n, files)
    else missing.push(n)
  }
  if (missing.length > 0) {
    const second = await client.listPageImages(missing.map((n) => `Card Gallery:${n} (card)`))
    for (const n of missing) {
      const files = second.get(`Card Gallery:${n} (card)`)
      if (files) out.set(n, files)
    }
  }
  return out
}
