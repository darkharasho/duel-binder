const SET_IMAGE_RE = /^https:\/\/images\.ygoprodeck\.com\/images\/sets\/([A-Za-z0-9_-]+)\.jpg$/

/** Stem of a YGOPRODeck set-image URL; null for anything outside that folder. */
export function setImageKey(sourceUrl: string | null): string | null {
  if (sourceUrl === null) return null
  return SET_IMAGE_RE.exec(sourceUrl)?.[1] ?? null
}
