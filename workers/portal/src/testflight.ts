import { signEs256Jwt } from './apple'

/**
 * Adds iPhone beta testers to the external TestFlight group through the App Store Connect API;
 * Apple then emails them the invite (once a build in the group has passed Beta App Review).
 */
export interface TestFlightEnv {
  /** The team's issuer id (Users and Access → Integrations → App Store Connect API). */
  ASC_ISSUER_ID?: string
  ASC_KEY_ID?: string
  /** Worker secret: the API key's .p8 file, a PKCS#8 PEM. App Manager is enough. */
  ASC_KEY?: string
  /** The external beta group testers join. */
  ASC_BETA_GROUP_ID?: string
}

interface TestFlightDeps {
  env: TestFlightEnv
  fetch: typeof fetch
  now: () => Date
}

export const ASC_API = 'https://api.appstoreconnect.apple.com'

export const testFlightConfigured = (env: TestFlightEnv): boolean =>
  !!(env.ASC_ISSUER_ID && env.ASC_KEY_ID && env.ASC_KEY && env.ASC_BETA_GROUP_ID)

/** Splits "Sam Lee" into Apple's first and last name; a single word is just a first name. */
function names(name: string): { firstName: string; lastName?: string } {
  const parts = name.trim().split(/\s+/)
  return parts.length > 1
    ? { firstName: parts[0], lastName: parts.slice(1).join(' ') }
    : { firstName: parts[0] }
}

/**
 * Puts `email` in the beta group. True once Apple has them in it (including when they already
 * were); false when the API isn't configured or refuses.
 */
export async function addTestFlightTester(
  tester: { email: string; name: string },
  deps: TestFlightDeps
): Promise<boolean> {
  const { env } = deps
  if (!testFlightConfigured(env)) return false
  const group = env.ASC_BETA_GROUP_ID!
  try {
    const iat = Math.floor(deps.now().getTime() / 1000)
    const token = await signEs256Jwt(
      env.ASC_KEY!,
      { alg: 'ES256', kid: env.ASC_KEY_ID!, typ: 'JWT' },
      { iss: env.ASC_ISSUER_ID!, iat, exp: iat + 600, aud: 'appstoreconnect-v1' }
    )
    const call = (
      path: string,
      init: { method?: string; body?: unknown } = {}
    ): Promise<Response> =>
      deps.fetch(ASC_API + path, {
        method: init.method ?? 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' })
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body)
      })

    const created = await call('/v1/betaTesters', {
      method: 'POST',
      body: {
        data: {
          type: 'betaTesters',
          attributes: { email: tester.email, ...names(tester.name) },
          relationships: { betaGroups: { data: [{ type: 'betaGroups', id: group }] } }
        }
      }
    })
    if (created.ok) return true
    if (created.status !== 409) {
      console.error('testflight add failed', created.status, await created.text().catch(() => ''))
      return false
    }
    // Apple already knows this email (another group, or an earlier invite): add them to ours.
    const found = await call(
      `/v1/betaTesters?filter[email]=${encodeURIComponent(tester.email)}&limit=1`
    )
    const id = found.ok
      ? ((await found.json()) as { data?: { id?: string }[] }).data?.[0]?.id
      : undefined
    if (!id) {
      console.error('testflight lookup failed', found.status)
      return false
    }
    const linked = await call(`/v1/betaGroups/${group}/relationships/betaTesters`, {
      method: 'POST',
      body: { data: [{ type: 'betaTesters', id }] }
    })
    if (!linked.ok) console.error('testflight link failed', linked.status)
    return linked.ok
  } catch (e) {
    console.error('testflight add failed', e)
    return false
  }
}
