import type { ZhSetEntry } from './chinese'

/**
 * Simplified Chinese release dates, by the list's set id, from Bulbapedia's "(ATCG)" expansion
 * pages (checked 2026-11-16; matched to ids by their Chinese names). The list itself has no dates.
 * Both or all three halves of a split expansion came out together. 30th Celebration came out on
 * the same day worldwide.
 */
// prettier-ignore
export const CHINESE_SET_DATES: Readonly<Record<string, string>> = {
  CSM1aC: '2022-10-28', CSM1bC: '2022-10-28', CSM1cC: '2022-10-28',
  CSM2aC: '2023-01-18', CSM2bC: '2023-01-18', CSM2cC: '2023-01-18',
  CS1aC: '2023-05-19', CS1bC: '2023-05-19',
  CS2aC: '2023-08-18', CS2bC: '2023-08-18',
  CS3aC: '2023-11-17', CS3bC: '2023-11-17',
  CS4aC: '2024-03-01', CS4bC: '2024-03-01',
  CS5aC: '2024-06-18', CS5bC: '2024-06-18',
  CS6aC: '2024-09-20', CS6bC: '2024-09-20',
  CSV1C: '2025-01-17', CBB1C: '2025-01-17', '151C': '2025-01-17',
  CSV2C: '2025-03-21',
  CSV3C: '2025-05-16', CBB2C: '2025-05-16',
  CSVL1C: '2025-06-13',
  CSV4C: '2025-07-18',
  CSV5C: '2025-09-12',
  CBB3C: '2025-09-26',
  CSV6C: '2025-11-07',
  CSVL2C: '2025-11-17',
  CSV7C: '2026-01-16',
  CBB4C: '2026-02-06',
  CSV8C: '2026-03-13',
  CBB5C: '2026-04-24',
  CSV9C: '2026-05-15', CSVNC: '2026-05-15',
  'CSV9.5C': '2026-06-12',
  CSV10C: '2026-07-16',
  CBB6C: '2026-08-07',
  '30thC': '2026-09-16', '30thDC': '2026-09-16', '30thPC': '2026-09-16',
  CBB7C: '2026-11-07'
}

/**
 * Every set's date: its own where it's known, else the earlier of its nearest dated neighbours in
 * the list's index, which runs newest first. That is the date of the set listed just before it in
 * time, so the Sets page keeps the list's order and the month shown is close: decks, gift boxes
 * and packs mostly came out with the expansion beside them. Taking the earlier neighbour also
 * copes with the few sets the index adds out of order at its end (151's waves, 30th Celebration).
 */
export function chineseSetDates(
  index: readonly ZhSetEntry[],
  known: Readonly<Record<string, string>> = CHINESE_SET_DATES
): Map<string, string> {
  const ids: string[] = []
  for (const s of index) {
    if (s.id === 'PROMO') continue
    const id = s.id.startsWith(`${s.code}-`) ? s.code : s.id
    if (!ids.includes(id)) ids.push(id)
  }
  const newer: (string | undefined)[] = []
  let last: string | undefined
  for (const id of ids) newer.push((last = known[id] ?? last))
  const out = new Map<string, string>()
  last = undefined
  for (let i = ids.length - 1; i >= 0; i--) {
    const own = known[ids[i]]
    const older = (last = own ?? last)
    const near = [newer[i], older].filter((d): d is string => d !== undefined).sort()[0]
    if (near !== undefined) out.set(ids[i], own ?? near)
  }
  for (const [id, date] of Object.entries(known)) if (!out.has(id)) out.set(id, date)
  return out
}
