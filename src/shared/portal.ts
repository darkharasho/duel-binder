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
  'account:dismissLinkHint'
] as const satisfies readonly InvokeChannel[]

/**
 * Worker-only RPC channels for linking a sign-in. They aren't InvokeChannels: each client calls
 * them from its own linking flow, not through the shared Api.
 * - `account:linkCode(code, verifier)`: a Discord link code from `/auth/desktop/start?intent=link`.
 * - `account:linkApple({ identityToken, nonce, authorizationCode? })`: Sign in with Apple.
 * Both answer a `LinkResult` (shared/account.ts).
 */
export const ACCOUNT_LINK_CHANNELS = ['account:linkCode', 'account:linkApple'] as const

export type AccountLinkChannel = (typeof ACCOUNT_LINK_CHANNELS)[number]

export type PortalChannel = (typeof PORTAL_CHANNELS)[number] | AccountLinkChannel
