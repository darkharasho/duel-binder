import { describe, expect, it, vi } from 'vitest'
import type { GhRun } from '@shared/admin'
import { loadRuns, minutes, stateOf, stepState, typical } from '@/features/admin/runs'

const run = (over: Partial<GhRun>): GhRun => ({
  id: 1,
  html_url: 'https://github.com/x',
  status: 'completed',
  conclusion: 'success',
  event: 'schedule',
  run_started_at: '2026-11-08T10:00:00Z',
  updated_at: '2026-11-08T10:10:00Z',
  ...over
})

describe('admin runs', () => {
  it('reads states, steps and lengths', () => {
    expect(stateOf(run({}))).toEqual(['Passed', 'good'])
    expect(stateOf(run({ status: 'queued', conclusion: null }))).toEqual(['Queued', 'live'])
    expect(stateOf(run({ status: 'in_progress', conclusion: null }))).toEqual(['Running', 'live'])
    expect(minutes(125 * 60000)).toBe('2 h 5 min')
    expect(typical([run({}), run({ conclusion: 'failure' })])).toBe(10 * 60000)
    const now = Date.parse('2026-11-08T10:00:30Z')
    expect(
      stepState(
        {
          name: 'x',
          status: 'in_progress',
          conclusion: null,
          started_at: '2026-11-08T10:00:00Z',
          completed_at: null
        },
        now
      )
    ).toEqual(['30 s so far', 'live'])
  })

  it('reads jobs only for the runs it lists steps for', async () => {
    const admin = {
      runs: vi.fn(async (file: string) =>
        file === 'catalog.yml' ? [run({ id: 1 })] : [run({ id: 2, event: 'push' })]
      ),
      jobs: vi.fn(async () => [])
    }
    const view = await loadRuns(admin as never)
    expect(admin.jobs).toHaveBeenCalledExactlyOnceWith(1)
    expect(view.all.map((r) => r.name)).toEqual(['Catalog', 'Release'])
    expect(view.live).toBe(false)
  })
})
