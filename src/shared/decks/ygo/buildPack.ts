import { RULES_SCHEMA, type YgoFormatRules, type YgoRulesPack } from '../pack'

export interface YgoPackCard {
  id: number
  banlist_info?: { ban_tcg?: string; ban_ocg?: string }
  misc_info?: { tcg_date?: string; ocg_date?: string }[]
}

/** YGOPRODeck says "Banned" in places and "Forbidden" in others; both mean none allowed. */
const LIMITS: Record<string, 0 | 1 | 2> = {
  Banned: 0,
  Forbidden: 0,
  Limited: 1,
  'Semi-Limited': 2
}

function addCard(
  rules: YgoFormatRules,
  id: number,
  ban: string | undefined,
  date: string | undefined,
  today: string
): void {
  const limit = ban === undefined ? undefined : LIMITS[ban]
  if (limit !== undefined) rules.limits[String(id)] = limit
  if (!date) rules.notReleased[String(id)] = null
  else if (date > today) rules.notReleased[String(id)] = date
}

/** Builds the Yu-Gi-Oh! rules pack from YGOPRODeck's cardinfo (`misc=yes`) records. */
export function buildYgoPack(cards: YgoPackCard[], builtAt: Date): YgoRulesPack {
  const iso = builtAt.toISOString()
  const today = iso.slice(0, 10)
  const advanced: YgoFormatRules = { limits: {}, notReleased: {} }
  const ocg: YgoFormatRules = { limits: {}, notReleased: {} }
  for (const c of cards) {
    const misc = c.misc_info?.[0]
    addCard(advanced, c.id, c.banlist_info?.ban_tcg, misc?.tcg_date, today)
    addCard(ocg, c.id, c.banlist_info?.ban_ocg, misc?.ocg_date, today)
  }
  return {
    schema: RULES_SCHEMA,
    game: 'ygo',
    version: today,
    builtAt: iso,
    sources: [{ name: 'YGOPRODeck', fetchedAt: iso }],
    formats: { advanced, ocg }
  }
}
