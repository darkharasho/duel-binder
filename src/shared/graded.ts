import type { GameId } from './games'
import type { CardRow, Printing } from './types'

/**
 * Graded copies (slabs): one card in a grading company's case, tracked one by one apart from the
 * collection's quantities. A slab never counts toward set, binder or wishlist completion.
 */

/** The grading companies the form offers, most used first; anything else is typed under "Other". */
export const GRADING_COMPANIES = [
  'PSA',
  'BGS',
  'CGC',
  'SGC',
  'TAG',
  'ACE',
  'ARS',
  'PCG',
  'CCIC'
] as const

/** Grades a slab can carry: 1 to 10 in half steps, or "Authentic" for an ungraded, authenticated card. */
export const AUTHENTIC = 'Authentic'
export const GRADES: readonly string[] = [
  '10',
  '9.5',
  '9',
  '8.5',
  '8',
  '7.5',
  '7',
  '6.5',
  '6',
  '5.5',
  '5',
  '4.5',
  '4',
  '3.5',
  '3',
  '2.5',
  '2',
  '1.5',
  '1',
  AUTHENTIC
]

export const MAX_COMPANY = 24
/** The label's qualifier, e.g. "Black Label", "Pristine", "Gem Mint". */
export const MAX_GRADE_LABEL = 40
export const MAX_CERT = 40
export const MAX_GRADED_NOTES = 2000
/** Most dollars a value or price paid may hold. */
export const MAX_GRADED_PRICE = 10_000_000

/** The fields a user edits on a graded copy, as stored and synced. */
export interface GradedFields {
  company: string
  grade: string
  /** The label's qualifier; '' for none. */
  label: string
  /** The certification number; '' when not entered. */
  cert: string
  /**
   * Beckett-style subgrades as "centering corners edges surface" ("9.5 10 10 9.5"), each a grade
   * 1 to 10 in half steps; '' for none.
   */
  subgrades: string
  /** What the user says the slab is worth, in USD; null when not entered. */
  value: number | null
  /** What the user paid, in USD; null when not entered. */
  paid: number | null
  notes: string
}

/** A new slab (no uid) or an edit of one, from the card panel's form. */
export interface GradedDraft extends GradedFields {
  uid?: string
  printingId: number
  /** The art in the case; the printing's own art (or the card's first) when left out. */
  imageId?: number
}

/** A slab as the app shows it. */
export interface GradedCopy extends GradedFields {
  uid: string
  game: GameId
  /** The printing's sync key; the same on every device, unlike `printing.id`. */
  pkey: string
  card: CardRow
  printing: Printing
  imageId: number
  /** As on EntryView: whether the printing's own scan shows. */
  printingScan: boolean
  photoPrintingId?: number | null
  /** The raw (ungraded) card's price, shown beside a slab with no value entered. */
  rawPrice: number | null
  /**
   * What eBay asks for this printing in this grader's slab at this grade (the median of its
   * listings), priced on the server for slabs people own; null until known.
   */
  market: { price: number; listings: number; checkedAt: string } | null
  createdAt: string
}

/** Thrown for a bad field; callers map it to their own error type. */
export class GradedFieldError extends Error {}

function text(v: unknown, what: string, max: number, required = false): string {
  if (typeof v !== 'string') throw new GradedFieldError(`${what} must be text`)
  const t = v.trim()
  if (required && !t) throw new GradedFieldError(`${what} is required`)
  if (t.length > max) throw new GradedFieldError(`${what} must be at most ${max} characters`)
  return t
}

function money(v: unknown, what: string): number | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_GRADED_PRICE)
    throw new GradedFieldError(
      `${what} must be empty or a dollar amount from 0 to ${MAX_GRADED_PRICE}`
    )
  return Math.round(v * 100) / 100
}

/** The four subgrades, in the order a Beckett label lists them. */
export const SUBGRADE_NAMES = ['Centering', 'Corners', 'Edges', 'Surface'] as const

/** Grades a subgrade can be: 1 to 10 in half steps. */
export const SUBGRADE_GRADES: readonly string[] = GRADES.filter((g) => g !== AUTHENTIC)

/** Stored subgrades ('' or four grades) as their four values, or null for none. */
export function parseSubgrades(s: string): string[] | null {
  const parts = s.trim().split(/\s+/)
  return parts.length === 4 && parts.every((p) => SUBGRADE_GRADES.includes(p)) ? parts : null
}

function checkSubgrades(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (typeof v !== 'string') throw new GradedFieldError('Subgrades must be text')
  const t = v.trim().replace(/\s+/g, ' ')
  if (!t) return ''
  if (!parseSubgrades(t))
    throw new GradedFieldError('Subgrades must be four grades from 1 to 10 in half steps')
  return t
}

/** Checks and tidies a slab's editable fields (trimmed text, cents); throws GradedFieldError. */
export function checkGradedFields(o: Record<string, unknown>): GradedFields {
  const grade = text(o.grade, 'Grade', 16, true)
  if (!GRADES.includes(grade))
    throw new GradedFieldError('Grade must be 1 to 10 in half steps, or Authentic')
  return {
    company: text(o.company, 'Grading company', MAX_COMPANY, true),
    grade,
    label: text(o.label ?? '', 'Label', MAX_GRADE_LABEL),
    cert: text(o.cert ?? '', 'Cert number', MAX_CERT),
    subgrades: checkSubgrades(o.subgrades),
    value: money(o.value, 'Value'),
    paid: money(o.paid, 'Price paid'),
    notes: text(o.notes ?? '', 'Notes', MAX_GRADED_NOTES)
  }
}

/** "PSA 10", "BGS 9.5 Black Label", "CGC Authentic". */
export const gradeTitle = (g: Pick<GradedFields, 'company' | 'grade' | 'label'>): string =>
  [g.company, g.grade, g.label].filter(Boolean).join(' ')

/**
 * A slab's worth for totals: the value entered, else eBay's asking price for its grade, else
 * nothing (a raw price undersells a slab).
 */
export const gradedWorth = (g: Pick<GradedCopy, 'value' | 'market'>): number =>
  g.value ?? g.market?.price ?? 0

/**
 * Totals for a list of slabs: how many, their worth (gradedWorth), how many have neither a value
 * nor an eBay price, and what was paid.
 */
export function gradedTotals(slabs: GradedCopy[]): {
  count: number
  value: number
  unvalued: number
  paid: number
} {
  return {
    count: slabs.length,
    value: slabs.reduce((sum, s) => sum + gradedWorth(s), 0),
    unvalued: slabs.filter((s) => s.value === null && !s.market).length,
    paid: slabs.reduce((sum, s) => sum + (s.paid ?? 0), 0)
  }
}
