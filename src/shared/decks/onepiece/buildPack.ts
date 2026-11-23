import { RULES_SCHEMA, parseRulesPack, type OpRulesPack } from '../pack'

/** The hand-kept `rules/onepiece.json`: Bandai publishes no legality data to build from. */
export interface OpRulesFile {
  /** YYYY-MM-DD the file was last checked against Bandai's pages */
  asOf: string
  /** The Bandai pages it was checked against */
  source: string
  formats: OpRulesPack['formats']
  setBlocks: Record<string, number>
  /** Card numbers a deck may hold any number of (their text says so) */
  unlimited?: string[]
}

/** Wraps the rules file as a pack; throws when the result wouldn't parse. */
export function buildOpPack(file: OpRulesFile, builtAt: Date): OpRulesPack {
  const pack: OpRulesPack = {
    schema: RULES_SCHEMA,
    game: 'op',
    version: file.asOf,
    builtAt: builtAt.toISOString(),
    sources: [{ name: 'Bandai', fetchedAt: file.asOf }],
    formats: file.formats,
    setBlocks: file.setBlocks,
    unlimited: file.unlimited ?? []
  }
  if (parseRulesPack(pack).state !== 'ready') throw new Error('onepiece.json is malformed')
  return pack
}
