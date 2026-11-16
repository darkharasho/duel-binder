import type { AdminSupporters } from '@shared/admin'
import { n } from './adminTabs'
import { Grid, Note, Panel, Tile } from './parts'

const ACTIVE = ['active', 'trialing', 'past_due']
const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`
const date = (iso: string | null): string => (iso ? iso.slice(0, 10) : '–')

/** Stripe keeps 2.9% + 30¢ of each charge; a yearly charge's net is spread over its 12 months. */
function netMonthlyCents(s: AdminSupporters): number {
  let net = 0
  for (const x of s.list) {
    if (!ACTIVE.includes(x.status) || !x.plan || !x.amountCents) continue
    net += (x.amountCents * 0.971 - 30) / (x.plan === 'year' ? 12 : 1)
  }
  return Math.round(net)
}

/** The portal's Supporters tab: how many supporters, what they bring in a month, and who. */
export function SupportersTab({
  supporters: s
}: {
  supporters: AdminSupporters
}): React.JSX.Element {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3">
        <Tile value={n(s.active)} label="supporters" />
        <Tile value={n(s.monthly)} label="monthly" />
        <Tile value={n(s.yearly)} label="yearly" />
        <Tile value={dollars(s.monthlyCents)} label="a month, before Stripe fees" />
        <Tile value={dollars(netMonthlyCents(s))} label="a month, after Stripe fees (about)" />
      </div>
      <Panel title="Supporters">
        {s.list.length === 0 ? (
          <Note>No supporters yet.</Note>
        ) : (
          <Grid
            heads={['User', 'Plan', 'Status', 'Since', 'Paid until', 'Thanks list']}
            left={3}
            rows={s.list.map((x) => ({
              key: x.userId,
              cells: [
                x.displayName ? `${x.displayName} (${x.username})` : x.username,
                x.plan ?? '–',
                x.status + (x.cancelling ? ' (cancelling)' : ''),
                date(x.since),
                date(x.until),
                x.showOnSite ? 'yes' : 'no'
              ]
            }))}
          />
        )}
        <div className="mt-3">
          <Note>Early access: add a supporter to the Testers tab for the game in preview.</Note>
        </div>
      </Panel>
    </div>
  )
}
