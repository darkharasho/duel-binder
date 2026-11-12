/** The facts that make a Magic image's art look as it does; rows sharing them share a record. */
export interface MagicLookRow {
  illustration_id: string | null
  frame: string | null
  border_color: string | null
  full_art: number
  image_id: number
}

/**
 * The key of a Magic artwork's look: its illustration in one frame, border and full-art or not.
 * An image with no illustration id is a look of its own.
 */
export function mtgLookKey(row: MagicLookRow): string {
  return row.illustration_id === null
    ? `img:${row.image_id}`
    : `${row.illustration_id}|${row.frame}|${row.border_color}|${row.full_art}`
}

/**
 * The row standing for each look (by mtgLookKey) among rows with art of their own: the look's
 * English row, else its lowest image id. The nightly fingerprint file hashes this row, so the app
 * names a look by the same id.
 */
export function lookRepresentative<R extends MagicLookRow & { lang: string }>(
  rows: R[]
): Map<string, R> {
  const looks = new Map<string, R>()
  for (const r of rows) {
    const key = mtgLookKey(r)
    const was = looks.get(key)
    if (
      !was ||
      (was.lang !== 'en' && r.lang === 'en') ||
      ((was.lang === 'en') === (r.lang === 'en') && r.image_id < was.image_id)
    )
      looks.set(key, r)
  }
  return looks
}
