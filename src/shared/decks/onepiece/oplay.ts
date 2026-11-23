/**
 * OPlay (oplaytcg.com) deck codes and share links, read and written the way their deck builder does
 * (format in the decks design spec, "OPlay compatibility"). v1 is '1' + base64url of a plain list;
 * v2 is '2' + a bit-packed payload + one check character.
 */

export interface OplayDeck {
  leader: string | null
  entries: { code: string; qty: number }[]
}

export class OplayError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OplayError'
  }
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const FAMILIES = ['OP', 'ST', 'EB', 'PRB', 'P']
const CUSTOM = 14
const RAW = 15
const MAX_ENTRIES = 80
/** A whole One Piece card number, as OPlay checks it (the same shape as text.ts's OP_CODE). */
const CARD = /^[A-Za-z]{1,5}\d{0,3}-\d{1,4}[A-Za-z0-9_]*$/
/** A card number the packed form can hold; anything else is written raw. */
const PACKABLE = /^([A-Z]{1,4})(\d{2})?-(\d{3})$/
/** One v1 entry, "4xOP01-016". */
const V1_ENTRY = new RegExp(`^(\\d{1,2})x(${CARD.source.slice(1, -1)})$`, 'i')

const BROKEN = 'That OPlay deck code is incomplete or mistyped. Copy it from OPlay again.'

const isCard = (code: string): boolean => code.length <= 32 && CARD.test(code)

interface Parts {
  prefix: string
  set: number
  num: number
}

class BitWriter {
  bits: number[] = []
  write(value: number, width: number): void {
    for (let i = width - 1; i >= 0; i--) this.bits.push((value >> i) & 1)
  }
}

class BitReader {
  private pos = 0
  constructor(private readonly bits: number[]) {}
  read(width: number): number {
    if (this.pos + width > this.bits.length) throw new OplayError(BROKEN)
    let v = 0
    for (let i = 0; i < width; i++) v = (v << 1) | this.bits[this.pos++]
    return v
  }
}

function checkChar(payload: string): string {
  let t = 7
  for (let i = 0; i < payload.length; i++) t = (31 * t + payload.charCodeAt(i)) % 4093
  return ALPHABET[t % 64]
}

function partsOf(code: string): Parts | null {
  const m = PACKABLE.exec(code)
  if (!m) return null
  const set = m[2] ? parseInt(m[2], 10) : 0
  const num = parseInt(m[3], 10)
  // "OP00-001" would come back as "OP-001", so an explicit set 00 is written raw
  if ((m[2] && set === 0) || num > 1023) return null
  return { prefix: m[1], set, num }
}

/** One card; qty null = the Leader (no same-set bit, no qty). Returns what counts as "previous". */
function writeCard(
  w: BitWriter,
  code: string,
  qty: number | null,
  prev: Parts | null
): Parts | null {
  const p = partsOf(code)
  if (!p || p.set > 127 || (qty !== null && qty > 4)) {
    if (qty !== null) w.write(0, 1)
    w.write(RAW, 4)
    w.write(code.length - 1, 5)
    for (const ch of code) w.write(ch.charCodeAt(0) & 127, 7)
    if (qty !== null) w.write(Math.min(qty, 127), 7)
    return null
  }
  const same = prev !== null && prev.prefix === p.prefix && prev.set === p.set
  if (qty !== null) w.write(same ? 1 : 0, 1)
  if (!same) {
    const family = FAMILIES.indexOf(p.prefix)
    if (family >= 0) w.write(family, 4)
    else {
      w.write(CUSTOM, 4)
      w.write(p.prefix.length - 1, 2)
      for (const ch of p.prefix) w.write(ch.charCodeAt(0) - 65, 5)
    }
    w.write(p.set, 7)
  }
  w.write(p.num, 10)
  if (qty !== null) w.write(qty - 1, 2)
  return p
}

function readCard(
  r: BitReader,
  entry: boolean,
  prev: Parts | null
): { code: string; qty: number; parts: Parts | null } {
  let prefix: string
  let set: number
  if (entry && r.read(1) === 1) {
    if (!prev) throw new OplayError(BROKEN)
    ;({ prefix, set } = prev)
  } else {
    const family = r.read(4)
    if (family === RAW) {
      const len = r.read(5) + 1
      let code = ''
      for (let i = 0; i < len; i++) code += String.fromCharCode(r.read(7))
      return { code, qty: entry ? r.read(7) : 1, parts: null }
    }
    if (family === CUSTOM) {
      const len = r.read(2) + 1
      prefix = ''
      for (let i = 0; i < len; i++) {
        const letter = r.read(5)
        if (letter > 25) throw new OplayError(BROKEN)
        prefix += String.fromCharCode(65 + letter)
      }
    } else {
      if (family >= FAMILIES.length) throw new OplayError(BROKEN)
      prefix = FAMILIES[family]
    }
    set = r.read(7)
  }
  const parts = { prefix, set, num: r.read(10) }
  const code = `${prefix}${set ? String(set).padStart(2, '0') : ''}-${String(parts.num).padStart(3, '0')}`
  return { code, qty: entry ? r.read(2) + 1 : 1, parts }
}

function decodeV2(code: string): OplayDeck {
  const payload = code.slice(1, -1)
  if (!payload || checkChar(payload) !== code[code.length - 1]) throw new OplayError(BROKEN)
  const bits: number[] = []
  for (const ch of payload) {
    const v = ALPHABET.indexOf(ch)
    if (v < 0) throw new OplayError(BROKEN)
    for (let i = 5; i >= 0; i--) bits.push((v >> i) & 1)
  }
  const r = new BitReader(bits)
  let leader: string | null = null
  let prev: Parts | null = null
  if (r.read(1)) {
    const l = readCard(r, false, null)
    leader = l.code
    prev = l.parts
  }
  const count = r.read(7)
  if (count > MAX_ENTRIES) throw new OplayError(BROKEN)
  const entries: OplayDeck['entries'] = []
  for (let i = 0; i < count; i++) {
    const e = readCard(r, true, prev)
    prev = e.parts
    if (!CARD.test(e.code) || e.qty <= 0) throw new OplayError(BROKEN)
    entries.push({ code: e.code, qty: e.qty })
  }
  if ((leader && !CARD.test(leader)) || (!leader && entries.length === 0))
    throw new OplayError(BROKEN)
  return { leader, entries }
}

function decodeV1(code: string): OplayDeck {
  let text: string
  try {
    text = atob(code.slice(1).replace(/-/g, '+').replace(/_/g, '/'))
  } catch {
    throw new OplayError(BROKEN)
  }
  const bar = text.indexOf('|')
  if (bar < 0) throw new OplayError(BROKEN)
  const head = text.slice(0, bar).toUpperCase()
  const leader = head && CARD.test(head) ? head : null
  const entries: OplayDeck['entries'] = []
  const body = text.slice(bar + 1)
  if (body)
    for (const part of body.split(',')) {
      const m = V1_ENTRY.exec(part)
      if (!m) continue
      const qty = parseInt(m[1], 10)
      if (qty > 0) entries.push({ code: m[2].toUpperCase(), qty })
      if (entries.length >= MAX_ENTRIES) break
    }
  if (!leader && entries.length === 0) throw new OplayError(BROKEN)
  return { leader, entries }
}

/** A v1 or v2 deck code; throws OplayError when it's damaged or not a deck code. */
export function decodeOplay(code: string): OplayDeck {
  const c = code.trim()
  if (c.length < 2) throw new OplayError(BROKEN)
  if (c[0] === '2') return decodeV2(c)
  if (c[0] === '1') return decodeV1(c)
  throw new OplayError(BROKEN)
}

/** The v2 code OPlay shows for this deck: upper-cased, cards it can't read left out, at most 80 entries. */
export function encodeOplayV2(deck: OplayDeck): string {
  const leader = deck.leader && isCard(deck.leader) ? deck.leader.toUpperCase() : null
  const entries = deck.entries
    .filter((e) => e.qty > 0 && isCard(e.code))
    .map((e) => ({ code: e.code.toUpperCase(), qty: e.qty }))
    .slice(0, MAX_ENTRIES)
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
  const w = new BitWriter()
  w.write(leader ? 1 : 0, 1)
  let prev: Parts | null = null
  if (leader) prev = writeCard(w, leader, null, null)
  w.write(entries.length, 7)
  for (const e of entries) prev = writeCard(w, e.code, e.qty, prev)
  while (w.bits.length % 6) w.bits.push(0)
  let payload = ''
  for (let i = 0; i < w.bits.length; i += 6) {
    let v = 0
    for (let j = 0; j < 6; j++) v = (v << 1) | w.bits[i + j]
    payload += ALPHABET[v]
  }
  return '2' + payload + checkChar(payload)
}

/** OPlay's share link for a deck code. */
export function oplayLink(code: string): string {
  return `https://oplaytcg.com/en/deck-builder?d=${code}`
}
