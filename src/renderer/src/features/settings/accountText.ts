const REASONS: Record<string, string> = {
  'unknown-printing': "This printing isn't on the server yet",
  'unknown-card': "This card isn't on the server",
  'bad-field': 'The printing details were rejected',
  'daily-limit': 'Daily limit reached; Duel Binder will try again tomorrow'
}

/** Why an entry can't sync, from the server's reason code. */
export const reasonText = (code: string): string => REASONS[code] ?? "Couldn't sync this card"

export const DELETE_WARNING =
  'Delete your Duel Binder account? This removes your synced collection, friends and sign-ins on every device. Desktop apps keep their own copy and are signed out.'
