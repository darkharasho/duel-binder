export interface SetStat {
  setCode: string
  printings: number
  priced: number
}

/** A set this size or larger whose priced share falls this much since last night, with fewer priced, is a problem. */
export const SHARE_SET_MIN = 20
/** 20 points: a fifth. */
export const SHARE_DROP_PARTS = 5

const percent = (priced: number, printings: number): number =>
  Math.round((priced / printings) * 100)

/**
 * Sets whose priced share fell since last night: `old` is last night's stats by set code, `now`
 * tonight's. A set that only grew (more printings, none of its prices lost) is the catalog filling
 * in, not a drop.
 */
export function pricedShareProblems(old: Map<string, SetStat>, now: SetStat[]): string[] {
  const problems: string[] = []
  for (const s of now) {
    const o = old.get(s.setCode)
    if (!o || o.printings <= 0 || s.printings < SHARE_SET_MIN || s.priced >= o.priced) continue
    // old share - new share >= 1 / SHARE_DROP_PARTS, in whole numbers (1 - 0.8 is under 0.2 in floats).
    const fell =
      SHARE_DROP_PARTS * (o.priced * s.printings - s.priced * o.printings) >=
      o.printings * s.printings
    if (fell) {
      problems.push(
        `${s.setCode} priced share fell from ${percent(o.priced, o.printings)}% to ${percent(s.priced, s.printings)}%`
      )
    }
  }
  return problems
}
