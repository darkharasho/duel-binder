import type { Me } from '@shared/cloud'

export type { Me }

/** Same-origin `GET /api/me`: the signed-in user, or null when signed out (401). Other failures throw. */
export async function fetchMe(fetchFn: typeof fetch = fetch): Promise<Me | null> {
  const res = await fetchFn('/api/me', { credentials: 'same-origin' })
  if (res.status === 401) return null
  if (!res.ok) throw new Error(`Couldn't load account (${res.status})`)
  return (await res.json()) as Me
}
