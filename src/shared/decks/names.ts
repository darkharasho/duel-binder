/** A name as compared: NFKD, no combining marks, lowercase, straight quotes, single spaces. */
export function normalCardName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/** "Professor's Research (Professor Magnolia)" is "Professor's Research": a Trainer's subtitle names no new card. */
export function trainerBaseName(s: string): string {
  return s.replace(/\s*\([^()]*\)\s*$/, '')
}
