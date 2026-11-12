import { describe, expect, it } from 'vitest'
import { decide, STALE_HOURS } from '../../scripts/catalog/scheduleGate.mjs'

const at = (iso: string): Date => new Date(iso)

describe('catalog schedule gate', () => {
  it('runs on the first trigger in the quiet window', () => {
    expect(decide(at('2026-11-13T09:20:00Z'), [at('2026-11-12T09:20:00Z')]).run).toBe(true)
    expect(decide(at('2026-11-13T08:00:00Z'), [at('2026-11-12T12:59:00Z')]).run).toBe(true)
  })

  it('skips a trigger outside 08:00–13:00 UTC', () => {
    for (const t of ['2026-11-13T07:59:00Z', '2026-11-13T13:00:00Z', '2026-11-13T15:14:00Z']) {
      expect(decide(at(t), [at('2026-11-12T09:00:00Z')])).toMatchObject({ run: false })
    }
  })

  it('runs at most once a day, counting manual runs and runs still going', () => {
    const d = decide(at('2026-11-13T12:20:00Z'), [
      at('2026-11-12T09:00:00Z'),
      at('2026-11-13T09:17:00Z')
    ])
    expect(d.run).toBe(false)
    expect(d.reason).toMatch(/already ran today/)
    expect(decide(at('2026-11-13T09:20:00Z'), [at('2026-11-13T04:23:00Z')]).run).toBe(false)
  })

  it('runs whatever the hour once the catalog is going stale', () => {
    const last = at('2026-11-11T15:00:00Z')
    const stale = new Date(last.getTime() + STALE_HOURS * 3600_000)
    expect(decide(stale, [last]).run).toBe(true)
    expect(decide(new Date(stale.getTime() - 60_000), [last]).run).toBe(false)
    expect(decide(at('2026-11-13T20:00:00Z'), []).run).toBe(true)
  })
})
