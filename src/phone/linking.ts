import type { LinkResult, SignInMethod, SignInProvider } from '@shared/account'
import type { AppleLinkInput } from '@shared/account'
import type { PhoneStore } from './data/store'
import { appleSheet, nativeSignIn, SignInCancelled } from './nativeSignIn'

/** The sign-ins this app can add to the account: Discord everywhere native, Apple on iOS. */
export function linkableProviders(
  platform: 'web' | 'ios' | 'android',
  methods: SignInMethod[]
): SignInProvider[] {
  if (platform === 'web') return []
  const has = (p: SignInProvider): boolean => methods.some((m) => m.provider === p)
  const out: SignInProvider[] = []
  if (!has('discord')) out.push('discord')
  if (platform === 'ios' && !has('apple')) out.push('apple')
  return out
}

/**
 * Adds a sign-in to the signed-in account: shows the system's sign-in sheet, then hands the
 * result to the portal's link call. Resolves null when the person closes the sheet; rejects with
 * the portal's words when it refuses (a rate limit, say).
 */
export async function linkSignIn(
  provider: SignInProvider,
  deps: {
    store: Pick<PhoneStore, 'portal'>
    nativeSignIn?: typeof nativeSignIn
    appleSheet?: () => Promise<AppleLinkInput>
  }
): Promise<LinkResult | null> {
  const label = provider === 'apple' ? 'Apple' : 'Discord'
  // Only the sign-in sheet's failures get this fixed copy; the portal's refusals keep its words.
  const sheetStep = async <T>(open: () => Promise<T>): Promise<T> => {
    try {
      return await open()
    } catch (e) {
      if (e instanceof SignInCancelled) throw e
      throw new Error(`Couldn't link ${label}`, { cause: e })
    }
  }
  try {
    if (provider === 'discord') {
      const { code, verifier } = await sheetStep(() =>
        (deps.nativeSignIn ?? nativeSignIn)({ intent: 'link' })
      )
      return await deps.store.portal<LinkResult>('account:linkCode', [code, verifier])
    }
    const apple = await sheetStep(() => (deps.appleSheet ?? appleSheet)())
    const input: AppleLinkInput = {
      identityToken: apple.identityToken,
      nonce: apple.nonce,
      authorizationCode: apple.authorizationCode
    }
    return await deps.store.portal<LinkResult>('account:linkApple', [input])
  } catch (e) {
    if (e instanceof SignInCancelled) return null
    throw e
  }
}
