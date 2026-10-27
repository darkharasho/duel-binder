import { createContext, useContext } from 'react'
import type { Me } from '../shared/cloud'
import type { PhoneStore } from './data/store'

/** What the signed-in phone screens share: the store, the user, and a way back to sign-in. */
export interface PhoneSession {
  store: PhoneStore
  user: Me
  /** The phone signed out (or the account was deleted): show the sign-in screen. */
  signedOut(): void
}

export const PhoneContext = createContext<PhoneSession | null>(null)

export function usePhone(): PhoneSession {
  const session = useContext(PhoneContext)
  if (!session) throw new Error('usePhone needs a PhoneContext')
  return session
}

/** The name the phone shows for a user. */
export const displayName = (user: Me): string => user.displayName || user.username

/** Query keys for the store's own reads (not data channels). */
export const SYNC_STATE_KEY = ['phone', 'syncState'] as const
export const CATALOG_KEY = ['phone', 'catalog'] as const
