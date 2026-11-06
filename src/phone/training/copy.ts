/** The Contribute photos screen's fixed copy. */

export const CONTRIBUTE_TITLE = 'Contribute photos'
export const NUMBER_LABEL = 'Card number'
export const NUMBER_PLACEHOLDER = 'OP05-119'
/** Before the number the camera read, on the button that fills it in. */
export const READ_LABEL = 'Camera read'
export const NO_VERSIONS = 'No card with that number in your card data.'
export const NOT_SYNCED = "This version isn't synced yet. Sync, then try again."
export const GRAB_FAILED = "Couldn't take the photo. Try again."
export const SAVED = 'Saved'
export const CAP_REACHED = 'Daily limit reached. The rest upload tomorrow.'
export const OFFLINE_WAIT = "Offline: photos upload when you're back online."
export const DROPPED = 'A photo was refused by the server and removed.'

export const WHAT_TO_SHOOT_TITLE = 'What to shoot'
export const WHAT_TO_SHOOT = [
  'A spread of sets and rarities: Leaders, Characters, Events, Stages and DON!!.',
  'Every version you have of the same number, side by side: alternate arts and the base card, plain Parallel foils, SP, manga, Treasure Rare.',
  "Sleeves and top loaders too, since that's how you'll stream.",
  'A few angles of each: straight on, tilted, under a light.'
] as const

/** "12 photos · 1 waiting to upload · 3/500 today"; the server's part is left out while unknown. */
export function photoCount(
  summary: { total: number; today: number; dailyCap: number } | null,
  waiting: number
): string {
  const parts: string[] = []
  if (summary) parts.push(`${summary.total} ${summary.total === 1 ? 'photo' : 'photos'}`)
  if (waiting > 0) parts.push(`${waiting} waiting to upload`)
  if (summary) parts.push(`${summary.today}/${summary.dailyCap} today`)
  return parts.join(' · ')
}

/** Read number: the One Piece number held up in the preview's guide box, read on a tap. */
export const SNAP_BUTTON = 'Read number'
export const SNAP_READING = 'Reading…'
export const SNAP_HINT = 'Just the number (like OP01-001) in the box'
export const SNAP_NONE = "Couldn't read a number. Line up just the number in the box."
export const SNAP_MANY = 'More than one number read. Show just the one.'

/** "3 shots of this version". */
export const shotsOf = (n: number): string => `${n} ${n === 1 ? 'shot' : 'shots'} of this version`

/** The desktop screen's keys, in its header. */
export const DESKTOP_KEYS_HINT =
  'Type the number · Space shoots · N next card · Backspace deletes the last photo · Esc closes'
/** Beside the arrow keys, over a number's versions. */
export const VERSION_KEYS_HINT = 'pick the version'
