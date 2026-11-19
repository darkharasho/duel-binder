// Reading a graded slab's label: the grading company, the grade and the certification number,
// from the label's OCR text. Each is left out when the text doesn't show it for sure; the user
// fills in the rest on the form.

/** What a slab's label was read as. */
export interface SlabRead {
  company?: string
  /** One of GRADES (see @shared/graded): "10", "9.5"... or "Authentic". */
  grade?: string
  /** The label's qualifier when it prints one we know: "Pristine" or "Black Label". */
  label?: string
  cert?: string
}

/** Companies told by name; a logo OCR misreads ("P5A") is matched by its usual misreads too. */
const COMPANIES: [string, RegExp][] = [
  ['PSA', /\b(PSA|P5A|PSA\/DNA)\b/],
  ['BGS', /\b(BGS|BECKETT)\b/],
  ['CGC', /\b(CGC|CGG|C6C)\b/],
  ['SGC', /\bSGC\b/],
  // Not a card named "TAG TEAM".
  ['TAG', /\bTAG\b(?!\s*-?\s*TEAM)/],
  ['ACE', /\bACE\b(?! ?SPEC)/],
  ['ARS', /\bARS\b/],
  ['PCG', /\bPCG\b/],
  ['CCIC', /\bCCIC\b/]
]

/**
 * PSA's grade words, each its whole grade (a half grade adds "+" and its own number, e.g.
 * "NM-MT+ 8.5"). Only PSA abbreviates so, so these tell a PSA label whose logo didn't read.
 */
const PSA_WORDS: [RegExp, number][] = [
  [/\bGEM\s*-?\s*MT\b/, 10],
  [/\bNM\s*-\s*MT\b/, 8],
  [/\bEX\s*-\s*MT\b/, 6],
  [/\bVG\s*-\s*EX\b/, 4],
  [/\bMINT\b/, 9],
  [/\bNM\b/, 7],
  [/\bEX\b/, 5],
  [/\bVG\b/, 3],
  [/\bGOOD\b/, 2],
  [/\bFR\b/, 1.5],
  [/\bPR\b/, 1]
]

/**
 * CGC's and BGS's grade words, each its grade (a "+" after the word adds a half). Longest first.
 * Their big grade digits misread far more often than the words ("8" as "3", "10" as "1").
 */
const WORD_GRADES: Record<'CGC' | 'BGS', [RegExp, number][]> = {
  CGC: [
    [/\bPRISTINE\b/, 10],
    [/\bGEM\s*MINT\b/, 10],
    [/\bNM\s*\/\s*MINT\b/, 8],
    [/\bNEAR\s*MINT\b/, 7],
    [/\bEX\s*\/\s*NM\b/, 6],
    [/\bVG\s*\/\s*EX\b/, 4],
    [/\bEXCELLENT\b/, 5],
    [/\bVERY\s*GOOD\b/, 3],
    [/\bMINT\b/, 9],
    [/\bGOOD\b/, 2],
    [/\bFAIR\b/, 1.5],
    [/\bPOOR\b/, 1]
  ],
  BGS: [
    [/\bPRISTINE\b/, 10],
    [/\bGEM\s*MINT\b/, 9.5],
    [/\bNM\s*-\s*MT\b/, 8],
    [/\bEX\s*-\s*MT\b/, 6],
    [/\bMINT\b/, 9],
    [/\bNM\b/, 7]
  ]
}

/**
 * A CGC or BGS label's grade from its word: the first table word found, a half up with a "+"
 * after it, or with a number after it that says the half (an OCR'd "+" is often lost). Undefined
 * when no word is found. Read off the raw text, case and all.
 */
function wordGrade(raw: string, company: 'CGC' | 'BGS'): number | undefined {
  for (const [re, whole] of WORD_GRADES[company]) {
    // In capitals, as labels print them (a card's "ex" isn't), and ending its line, as the
    // label's grade column does (stray marks after it aside).
    const m = new RegExp(re.source + '(\\s*\\+)?(?=[^A-Za-z0-9\\n]*(\\n|$))').exec(raw)
    if (!m) continue
    if (whole === 10) return 10
    if (m[1]) return whole + 0.5
    const half = numbersAfter(raw, m.index + m[0].length, 12).includes(whole + 0.5)
    return half ? whole + 0.5 : whole
  }
  return undefined
}

/**
 * Grade words other graders print just before the number ("GEM MINT 10", "NM/MINT+ 8.5",
 * "PRISTINE 10"), longest first so "GEM MINT" isn't read as "MINT".
 */
const GRADE_WORDS =
  /\b(PRISTINE|GEM\s*MINT|GEM\s*MT|NM\s*\/\s*MINT\+?|NM\s*-\s*MT\+?|NEAR\s*MINT\+?|MINT\+?|EX\s*\/\s*NM\+?|EX\s*-\s*MT\+?|VG\s*\/\s*EX\+?|VG\s*-\s*EX\+?|EXCELLENT\+?|VERY\s*GOOD\+?|GOOD\+?|FAIR|POOR|NM\+?|EX\+?|VG\+?|PR|FR)\b/g

/** A grade as printed: 1 to 10, with an optional half. "1O" and "l0" are 10 misread. */
const GRADE_NUMBER = /^(10|[1-9](\.5)?)$/

function gradeText(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function tidy(token: string): string {
  return token
    .replace(/^[lI]0$/, '10')
    .replace(/^1[oO]$/, '10')
    .replace(/,/, '.')
}

/** The label's text read as company, grade, qualifier and cert, each only when sure. */
export function parseSlabLabel(raw: string): SlabRead {
  const text = raw.toUpperCase().replace(/[“”"']/g, ' ')
  const out: SlabRead = {}

  // CGC's label names the game with its year in brackets, "Pokémon (2017)": PSA's starts with
  // the year, "2012 POKEMON". A CGC label whose logo didn't read is told so.
  const cgcLayout = /\bPOK[EÉ]MON\s*\(\d{4}\)/.test(text)
  const company = COMPANIES.find(([, re]) => re.test(text))?.[0] ?? (cgcLayout ? 'CGC' : undefined)
  if (company) out.company = company

  // The cert: the longest run of 7 to 12 digits (a year or a card number is shorter).
  const certs = [...text.matchAll(/(?<![\d.])\d{7,12}(?![\d.])/g)].map((m) => m[0])
  if (certs.length) out.cert = certs.reduce((a, b) => (b.length > a.length ? b : a))

  // Words only other graders print: such a label isn't PSA's, whatever its logo read as.
  const notPsa =
    cgcLayout ||
    /\b(GEM\s*MINT|NM\s*\/\s*MINT|NEAR\s*MINT|PRISTINE|SUBGRADES?|CENTERING)\b/.test(text)
  const psaLabel = (company === undefined || company === 'PSA') && !notPsa
  const psa = psaLabel ? psaGrade(text) : undefined
  // A label with PSA's words whose number didn't agree with them is left unread: another
  // grader's reading of it would take the wrong number.
  const psaWords = psaLabel && PSA_WORDS.some(([re]) => re.test(text))
  const byWord = company === 'CGC' || company === 'BGS' ? wordGrade(raw, company) : undefined
  const grade = psa ?? byWord ?? (company !== 'PSA' && !psaWords ? otherGrade(text) : undefined)
  if (grade !== undefined) {
    out.grade = gradeText(grade)
    // PSA's words are its own: a label read with them and no logo is PSA's.
    if (!out.company && psa !== undefined) out.company = 'PSA'
  } else if (/\bAUTHENTIC\b/.test(text)) {
    out.grade = 'Authentic'
  }
  if (/\bBLACK\s*LABEL\b/.test(text)) out.label = 'Black Label'
  else if (/\bPRISTINE\b/.test(text)) out.label = 'Pristine'
  return out
}

interface Token {
  text: string
  /** The last token on its line: where a label's right-hand column (its grade) ends up. */
  last: boolean
}

/** The tokens of text, in reading order, with the number misreads tidied. */
function tokens(text: string): Token[] {
  return text.split('\n').flatMap((line) => {
    const words = line
      .split(/\s+/)
      .map(tidy)
      .filter((t) => t.length > 0)
    return words.map((t, i) => ({ text: t, last: i === words.length - 1 }))
  })
}

/**
 * The grade numbers after index `from` of text, in order: ones right after it (within 2 tokens,
 * "GEM MINT 10"), and ones that end a line within `within` tokens (a label's grade column, which
 * OCR reads at the end of a later line). A 10 read with a gap between its digits ("1 0") counts.
 */
function numbersAfter(text: string, from: number, within: number): number[] {
  const next = tokens(text.slice(from)).slice(0, within + 1)
  const out: number[] = []
  for (let i = 0; i < Math.min(within, next.length); i++) {
    const near = i < 2
    const t = next[i]
    if (t.text === '1' && next[i + 1]?.text === '0' && (near || next[i + 1].last)) out.push(10)
    else if (GRADE_NUMBER.test(t.text) && (near || t.last)) out.push(Number(t.text))
  }
  return out
}

/**
 * A PSA label's grade: a PSA grade word with its number a few tokens after it (PSA prints the
 * word on one line and the number under it, so other words may come between), the number the
 * word's grade or its half step up. A word with no such number (a card named "Palkia EX") is
 * passed over. Undefined when no word and number agree.
 */
function psaGrade(text: string): number | undefined {
  for (const [re, whole] of PSA_WORDS) {
    for (const m of text.matchAll(new RegExp(re.source, 'g'))) {
      const n = numbersAfter(text, m.index! + m[0].length, 12).find(
        (x) => x === whole || x === whole + 0.5
      )
      if (n !== undefined) return n
    }
  }
  return undefined
}

/** Another grader's grade: the number after a grade word ("GEM MINT 10", "MINT+ 9.5"). */
function otherGrade(text: string): number | undefined {
  for (const m of text.matchAll(GRADE_WORDS)) {
    const [n] = numbersAfter(text, m.index! + m[0].length, 12)
    if (n !== undefined) return n
  }
  return undefined
}
