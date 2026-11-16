/** The optional supporter subscription (portal supporters.ts), as clients see it. */
export type SupporterPlan = 'month' | 'year'

export interface SupporterStatus {
  /** The portal's SUPPORTER_ENABLED is on: checkout is open. */
  enabled: boolean
  /** A Stripe customer exists for this account, so Manage (the Customer Portal) works. */
  hasCustomer: boolean
  /** Set while the subscription is active (or retrying a failed payment); null otherwise. */
  supporter: {
    plan: SupporterPlan
    /** When they first became a supporter, kept across lapses. ISO. */
    since: string
    /** The end of the paid period. ISO; null when Stripe didn't say. */
    until: string | null
    /** Cancelled, and ends at `until`. */
    cancelling: boolean
    showOnSite: boolean
  } | null
}

export const isSupporterPlan = (v: unknown): v is SupporterPlan => v === 'month' || v === 'year'
