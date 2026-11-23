/** Shown when the portal can't be reached. */
export const OFFLINE_MESSAGE = 'Could not reach Duel Binder. Check your connection and try again.'
/** Shown when a friends action is tried while signed out. */
export const FRIENDS_SIGNED_OUT = 'Sign in from Settings to see friends.'

/** Why someone reports another user (App Review guideline 1.2: users must be able to flag objectionable content). */
export type ReportReason = 'name' | 'photo' | 'harassment' | 'other'

/** The reasons in the order the report sheet lists them, with their labels. */
export const REPORT_REASONS: readonly { value: ReportReason; label: string }[] = [
  { value: 'name', label: 'Offensive name or picture' },
  { value: 'photo', label: 'Inappropriate photos' },
  { value: 'harassment', label: 'Harassment or spam' },
  { value: 'other', label: 'Something else' }
]

/** The longest note a report may carry. */
export const REPORT_NOTE_MAX = 500

/** What a report sends: why, an optional note, and whether to block them too. */
export interface UserReportInput {
  reason: ReportReason
  note?: string
  block?: boolean
}
