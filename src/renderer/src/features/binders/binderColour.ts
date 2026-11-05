/** Cover leathers. A binder keeps its colour on every device: it is picked from the binder's uid. */
export const BINDER_COLOURS = [
  '#4b1e22', // oxblood
  '#1e293b', // navy
  '#1d3327', // bottle green
  '#2b2a2d', // graphite
  '#5a3f2b', // saddle
  '#3a2238', // plum
  '#173338' // teal
] as const

/** The binder's cover colour, the same for the same uid. */
export function binderColour(uid: string): string {
  let h = 0
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) | 0
  return BINDER_COLOURS[Math.abs(h) % BINDER_COLOURS.length]
}

/** The style that hands a binder's colour to binderLook.css. */
export const binderStyle = (uid: string): React.CSSProperties =>
  ({ '--binder': binderColour(uid) }) as React.CSSProperties
