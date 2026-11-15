/** Synced account preferences. Shared by the Worker and the clients, so it imports nothing platform-specific. */

export type WashMode = 'random' | 'locked' | 'colourless'

type Lab3 = [number, number, number]

/** The renderer's `Families` without `greyArt`: the colours a locked wash is built from. */
export interface WashColours {
  fams: { lab: Lab3; share: number }[]
  dark: Lab3
  vivid: number
}

export interface Prefs {
  wash: { mode: WashMode; locked?: WashColours }
}

export const DEFAULT_PREFS: Prefs = { wash: { mode: 'random' } }

const MODES: readonly string[] = ['random', 'locked', 'colourless']
const MAX_FAMS = 8

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const isLab = (v: unknown): v is Lab3 => Array.isArray(v) && v.length === 3 && v.every(isNum)

function validColours(v: unknown): WashColours | null {
  if (!isObject(v)) return null
  const { fams, dark, vivid } = v
  if (!Array.isArray(fams) || fams.length < 1 || fams.length > MAX_FAMS) return null
  if (!isLab(dark) || !isNum(vivid)) return null
  const out: WashColours['fams'] = []
  for (const f of fams) {
    if (!isObject(f) || !isLab(f.lab) || !isNum(f.share)) return null
    out.push({ lab: [f.lab[0], f.lab[1], f.lab[2]], share: f.share })
  }
  return { fams: out, dark: [dark[0], dark[1], dark[2]], vivid }
}

/** Never throws. Anything invalid becomes the defaults, field by field; a bad `locked` is dropped and the mode kept. */
export function parsePrefs(raw: unknown): Prefs {
  const wash = isObject(raw) && isObject(raw.wash) ? raw.wash : null
  if (!wash || typeof wash.mode !== 'string' || !MODES.includes(wash.mode)) {
    return { wash: { ...DEFAULT_PREFS.wash } }
  }
  const out: Prefs['wash'] = { mode: wash.mode as WashMode }
  const locked = wash.locked === undefined ? null : validColours(wash.locked)
  if (locked) out.locked = locked
  return { wash: out }
}

/** Strict, for the Worker: null for any invalid input. The only allowed top-level key is `wash`. */
export function validPrefsPatch(raw: unknown): Partial<Prefs> | null {
  if (!isObject(raw)) return null
  for (const k of Object.keys(raw)) if (k !== 'wash') return null
  if (!('wash' in raw)) return {}
  const wash = raw.wash
  if (!isObject(wash) || typeof wash.mode !== 'string' || !MODES.includes(wash.mode)) return null
  const out: Prefs['wash'] = { mode: wash.mode as WashMode }
  if (wash.locked !== undefined) {
    const locked = validColours(wash.locked)
    if (!locked) return null
    out.locked = locked
  }
  return { wash: out }
}
