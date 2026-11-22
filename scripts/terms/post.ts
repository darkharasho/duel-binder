/**
 * Search-term harvest, step 2 of 2: reads `terms-work/candidates.json` (from `terms:harvest`) and
 * the session's `terms-work/reviews.json`, and posts the kept terms to the portal as pending terms.
 *
 *   npm run terms:post -- [--dry-run]
 *
 * Env: PORTAL_URL, PORTAL_ADMIN_TOKEN. --dry-run prints the proposals instead of posting them.
 */
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Candidate } from './mine'
import { ReviewsSchema, toProposals } from './review'

const WORK_DIR = 'terms-work'
const MAX_POSTED = 100

const need = (name: string): string => {
  const v = process.env[name]
  if (!v) throw new Error(`${name} must be set`)
  return v
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const bad = argv.find((a) => a !== '--dry-run')
  if (bad) throw new Error(`Unknown argument ${bad}`)
  const dryRun = argv.includes('--dry-run')

  const cands = JSON.parse(await readFile(join(WORK_DIR, 'candidates.json'), 'utf8')) as Candidate[]
  const reviews = ReviewsSchema.parse(JSON.parse(await readFile(join(WORK_DIR, 'reviews.json'), 'utf8')))
  const proposals = toProposals(cands, reviews)
    .sort((a, b) => b.evidence.sellers - a.evidence.sellers)
    .slice(0, MAX_POSTED)

  if (dryRun || proposals.length === 0) {
    console.log(JSON.stringify(proposals, null, 2))
    console.log(`${proposals.length} proposals from ${reviews.length} reviews${dryRun ? ' (dry run, not posted)' : ''}`)
    return
  }
  const portalUrl = need('PORTAL_URL').replace(/\/$/, '')
  const res = await fetch(`${portalUrl}/admin/terms/propose`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${need('PORTAL_ADMIN_TOKEN')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ proposals })
  })
  if (!res.ok) throw new Error(`The portal refused the proposals (${res.status}): ${await res.text().catch(() => '')}`)
  console.log(`Portal added ${((await res.json()) as { added: number }).added} of ${proposals.length} as pending terms`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
