// What a slab's label says and how it's coloured, per grading company, after the real labels:
// each grader's own words for a grade, Beckett's label colours, CGC's and TAG's Pristine.
import { AUTHENTIC, parseSubgrades, type GradedCopy } from '@shared/graded'
import { gameDef } from '@shared/games'

/** Graders with a label of their own; any other company gets the plain slab. */
export type SlabKind = 'PSA' | 'BGS' | 'CGC' | 'SGC' | 'TAG' | 'ACE' | 'AGS' | 'plain'

const KINDS: readonly SlabKind[] = ['PSA', 'BGS', 'CGC', 'SGC', 'TAG', 'ACE', 'AGS']

export const slabKind = (company: string): SlabKind => {
  const c = company.trim().toUpperCase()
  if (c === 'BECKETT') return 'BGS'
  return (KINDS as readonly string[]).includes(c) ? (c as SlabKind) : 'plain'
}

/** Words for whole grades 1 to 10, as most graders print them. */
const WORDS: Record<string, string> = {
  '10': 'GEM MINT',
  '9': 'MINT',
  '8': 'NM-MT',
  '7': 'NM',
  '6': 'EX-MT',
  '5': 'EX',
  '4': 'VG-EX',
  '3': 'VG',
  '2': 'GOOD',
  '1.5': 'FAIR',
  '1': 'POOR'
}

/** Each grader's own words where they differ from WORDS. */
const OWN: Partial<Record<SlabKind, Record<string, string>>> = {
  PSA: { '10': 'GEM MT', '1.5': 'FR', '1': 'PR' },
  BGS: { '9.5': 'GEM MINT', '10': 'PRISTINE', '6': 'EX-NM' },
  CGC: { '9.5': 'MINT+', '8': 'NM/MINT', '7': 'NEAR MINT', '6': 'EX/NM', '4': 'VG/EX' },
  TAG: { '9.5': 'MINT+', '8': 'NM MINT', '7': 'NEAR MINT', '6': 'EX NM' },
  SGC: { '9.5': 'MINT+', '6': 'EX-NM' },
  AGS: { '10': 'GEM-MT', '9.5': 'MINT+' }
}

/** Shorter words for SGC's round badge. */
const SGC_BADGE: Record<string, string> = {
  'GEM MINT': 'GM',
  'MINT+': 'MT+',
  MINT: 'MT',
  PRISTINE: 'PRI'
}

const pristine = (label: string): boolean => /pristine/i.test(label)
const blackLabel = (label: string): boolean => /black/i.test(label)

/**
 * The grade's word on the label: a label the user typed that isn't a variant flag wins
 * ("Gem Mint"), then the grader's own word, then the common one, with "+" for a half grade.
 */
export function gradeWord(
  kind: SlabKind,
  s: Pick<GradedCopy, 'grade' | 'label' | 'subgrades'>
): string {
  if (s.grade === AUTHENTIC) return 'AUTHENTIC'
  const label = s.label.trim()
  if (label && !blackLabel(label)) return label.toUpperCase()
  if (s.grade === '10' && (pristine(label) || blackLabel(label))) return 'PRISTINE'
  const own = OWN[kind]?.[s.grade]
  if (own) return own
  if (WORDS[s.grade]) return WORDS[s.grade]
  const whole = String(Math.floor(Number(s.grade)))
  return (OWN[kind]?.[whole] ?? WORDS[whole] ?? '') + '+'
}

/** SGC's badge text for a grade word ("GM", "MT"); the word itself when short. */
export const sgcBadge = (word: string): string =>
  SGC_BADGE[word] ?? (word.length <= 6 ? word : word.split(/[\s-/]/)[0])

/** Beckett's label colour: black for a Black Label, gold from 9.5, silver below. */
export function bgsMetal(
  s: Pick<GradedCopy, 'grade' | 'label' | 'subgrades'>
): 'black' | 'gold' | 'silver' {
  const subs = parseSubgrades(s.subgrades)
  if (s.grade === '10' && (blackLabel(s.label) || subs?.every((x) => x === '10'))) return 'black'
  return Number(s.grade) >= 9.5 ? 'gold' : 'silver'
}

/** AGS frames its label in gold from 9.5 up, navy below. */
export const agsGold = (s: Pick<GradedCopy, 'grade'>): boolean => Number(s.grade) >= 9.5

/** Whether a CGC, SGC or TAG 10 is a Pristine one, which gets gold. */
export const isPristine = (s: Pick<GradedCopy, 'grade' | 'label'>): boolean =>
  s.grade === '10' && pristine(s.label)

/** What the label's lines are made of. */
export interface LabelText {
  /** "2024 Yu-Gi-Oh!", or just the game when the set's date isn't known. */
  yearGame: string
  setName: string
  name: string
  rarity: string
  /** "#LOB-EN001", or '' with no set code. */
  number: string
  /** The grade as printed: the number, or "AUTH". */
  grade: string
  word: string
}

export function labelText(
  kind: SlabKind,
  s: Pick<GradedCopy, 'grade' | 'label' | 'subgrades' | 'card' | 'printing' | 'game'>
): LabelText {
  const year = s.printing.releaseDate?.slice(0, 4) ?? ''
  return {
    yearGame: [year, gameDef(s.game).name].filter(Boolean).join(' '),
    setName: s.printing.setName,
    name: s.card.name,
    rarity: s.printing.setRarity,
    number: s.printing.setCode ? `#${s.printing.setCode}` : '',
    grade: s.grade === AUTHENTIC ? 'AUTH' : s.grade,
    word: gradeWord(kind, s)
  }
}
