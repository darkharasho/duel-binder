import type { DeckSection } from './types'

/**
 * One imported line's reference to a card; Pokémon lines carry a set and number when they have them,
 * One Piece lines a card number (name '' when the line has none).
 */
export type DeckLineRef =
  | { passcode: number }
  | { setCode: string }
  | { set: string; number: string; name: string }
  | { opNumber: string; name: string }
  | { name: string }
export interface ParsedLine {
  line: number
  raw: string
  section: DeckSection
  qty: number
  ref: DeckLineRef
}
/**
 * skipped = non-empty, non-comment lines it couldn't read. sectioned = the list said which section
 * each card is in (.ydk, ydke://, or a text list with headers); a text list without headers puts
 * everything in Main, for the importer to place by card.
 */
export interface ParsedList {
  lines: ParsedLine[]
  skipped: { line: number; raw: string }[]
  sectioned: boolean
  /** Magic: the list named its sections (an Arena list); MTGO text has no names, only a blank line. */
  headed?: boolean
}
