import type { YugipediaClient } from './client'

/**
 * A card name as Yugipedia titles its pages. MediaWiki can't hold # < > [ ] { } | in a title
 * ("#" even starts a section link), so Yugipedia drops them: "Nekogal #1" is "Nekogal 1",
 * "Maliss <P> Dormouse" is "Maliss P Dormouse".
 */
export function yugipediaTitle(name: string): string {
  return name
    .replace(/[#<>[\]{}|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

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
  const gallery = (n: string, suffix = ''): string => `Card Gallery:${yugipediaTitle(n)}${suffix}`
  const first = await client.listPageImages([...new Set(unique.map((n) => gallery(n)))])
  const out = new Map<string, string[]>()
  const missing: string[] = []
  for (const n of unique) {
    const files = first.get(gallery(n))
    if (files) out.set(n, files)
    else missing.push(n)
  }
  if (missing.length > 0) {
    const second = await client.listPageImages([
      ...new Set(missing.map((n) => gallery(n, ' (card)')))
    ])
    for (const n of missing) {
      const files = second.get(gallery(n, ' (card)'))
      if (files) out.set(n, files)
    }
  }
  return out
}
