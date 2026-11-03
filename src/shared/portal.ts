import type { InvokeChannel } from './ipc'

/** The invoke channels the web portal serves (a subset of the desktop's). */
export const PORTAL_CHANNELS = [
  'cards:search',
  'cards:get',
  'cards:browse',
  'cards:browseFacets',
  'cards:borrowedArt',
  'cards:traditionalArt',
  'collection:list',
  'collection:forCard',
  'collection:add',
  'collection:update',
  'collection:remove',
  'collection:facets',
  'friends:overview',
  'friends:request',
  'friends:accept',
  'friends:ignore',
  'friends:remove',
  'friends:block',
  'friends:unblock',
  'friends:collection',
  'friends:facets',
  'friends:stats',
  'friends:sets',
  'friends:checklist',
  'friends:forCard',
  'friends:wishlist',
  'friends:binders',
  'friends:binder',
  'friends:wanting',
  'friends:owning',
  'friends:wishlistVisible',
  'friends:setWishlistVisible',
  'wishlist:list',
  'wishlist:forCard',
  'wishlist:set',
  'wishlist:remove',
  'favourites:list',
  'favourites:set',
  'binders:list',
  'binders:get',
  'binders:preview',
  'binders:save',
  'binders:remove',
  'binders:edit',
  'binders:forCard',
  'binders:fieldValues',
  'stats:get',
  'sets:list',
  'sets:checklist',
  'sets:adjust',
  'account:signIns',
  'account:setUsername',
  'account:removeSignIn',
  'account:dismissLinkHint',
  'account:addEmail',
  'account:confirmEmail',
  'account:resendEmailCode',
  'account:changePassword',
  'account:changeEmail'
] as const satisfies readonly InvokeChannel[]

/**
 * RPC channels for linking a sign-in, which the web portal's Api doesn't call. The first two
 * aren't InvokeChannels: each client calls them from its own linking flow, not through the shared
 * Api. Both answer a `LinkResult` (shared/account.ts).
 * - `account:linkCode(code, verifier)`: a Discord link code from `/auth/desktop/start?intent=link`.
 * - `account:linkApple({ identityToken, nonce, authorizationCode? })`: Sign in with Apple.
 * - `account:merge(ticket, { cards, username })`: merges the account a `merge` LinkResult found,
 *   answering the signed-in account's `Me`. It is `Api.account.merge`, which only the phone app
 *   implements; the desktop app and the web reject it.
 */
export const ACCOUNT_LINK_CHANNELS = ['account:linkCode', 'account:linkApple', 'account:merge'] as const

export type AccountLinkChannel = (typeof ACCOUNT_LINK_CHANNELS)[number]

export type PortalChannel = (typeof PORTAL_CHANNELS)[number] | AccountLinkChannel
