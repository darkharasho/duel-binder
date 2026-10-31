// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminPage } from '../../workers/portal/src/adminPage'

const NOW = new Date('2026-10-31T21:00:00Z').getTime()
const ago = (min: number): string => new Date(NOW - min * 60000).toISOString()
const run = (id: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  status: 'completed',
  conclusion: 'success',
  event: 'schedule',
  run_started_at: ago(100),
  updated_at: ago(80),
  html_url: `https://github.com/x/${id}`,
  ...over
})

const step = (name: string, conclusion: string, from: number, secs: number): Record<string, unknown> => ({
  name,
  status: 'completed',
  conclusion,
  started_at: new Date(NOW - 3600000 + from * 1000).toISOString(),
  completed_at: new Date(NOW - 3600000 + (from + secs) * 1000).toISOString()
})
const STEPS = [
  { name: 'Set up job', status: 'completed' },
  { name: 'Refresh and upload', status: 'in_progress' },
  { name: 'Parity check', status: 'queued' },
  { name: 'Complete job', status: 'queued' }
]
let steps: unknown[] = STEPS

async function open(
  catalog: unknown[],
  fail?: number
): Promise<{ text: string; fetched: string[] }> {
  const html = await adminPage().text()
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const script = doc.querySelector('script')!.textContent!
  doc.querySelector('script')!.remove()
  document.body.innerHTML = doc.body.innerHTML
  const fetched: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url)
    if (url.startsWith('/admin')) return new Response('{}', { status: 500 })
    if (fail) return new Response('{}', { status: fail })
    if (url.includes('/jobs')) {
      return Response.json({ jobs: [{ steps }] })
    }
    return Response.json({ workflow_runs: url.includes('catalog.yml') ? catalog : [] })
  })
  new Function(script)()
  await vi.waitFor(() => expect(document.getElementById('runs')!.textContent).toMatch(/\S/))
  return { text: document.getElementById('runs')!.textContent!, fetched }
}

describe('admin catalog runs', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    steps = STEPS
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows a running run with its step and time left, from past runs', async () => {
    const { text } = await open([
      run(2, { status: 'in_progress', conclusion: null, run_started_at: ago(5), event: 'workflow_dispatch' }),
      run(1)
    ])
    expect(text).toContain('Running')
    expect(text).toContain('manual')
    expect(text).toContain('Refresh and upload (step 2 of 4)')
    expect(text).toContain('5 min so far, about 15 min left')
    expect(document.querySelector<HTMLElement>('.run .bar div')!.style.width).toBe('25%')
    expect(text).toContain('Updates every 2 minutes')
  })

  it('shows the last run and does not poll when idle', async () => {
    const { text, fetched } = await open([run(1, { conclusion: 'failure' })])
    expect(text).toContain('Failed')
    expect(text).toContain('20 min')
    expect(text).toContain('Nothing running.')
    expect(fetched.filter((u) => u.includes('/jobs'))).toHaveLength(1)
  })

  it('lists a finished run\'s steps with their times and leaves out the plumbing', async () => {
    steps = [
      { name: 'Set up job', status: 'completed', conclusion: 'success' },
      { name: 'Run actions/checkout@v4', status: 'completed', conclusion: 'success' },
      step('Install', 'success', 0, 57),
      step('Upload catalog', 'success', 57, 240),
      step('Pokémon fingerprints', 'failure', 300, 45),
      { name: 'Parity check', status: 'completed', conclusion: 'skipped' },
      { name: 'Post Run actions/checkout@v4', status: 'completed', conclusion: 'success' },
      { name: 'Complete job', status: 'completed', conclusion: 'success' }
    ]
    await open([run(1, { conclusion: 'failure' })])
    const rows = [...document.querySelectorAll('.steps li')].map((li) => [
      li.children[0].textContent,
      li.children[1].textContent
    ])
    expect(rows).toEqual([
      ['Install', '57 s'],
      ['Upload catalog', '4 min'],
      ['Pokémon fingerprints', 'Failed · 45 s'],
      ['Parity check', 'skipped']
    ])
    expect(document.querySelector('.steps li.bad')!.textContent).toContain('Pokémon fingerprints')
  })

  it('lists a running run\'s steps with what is under way', async () => {
    steps = [
      step('Install', 'success', 0, 60),
      { name: 'Refresh Pokémon', status: 'in_progress', started_at: ago(3) },
      { name: 'Upload catalog', status: 'queued' }
    ]
    await open([run(2, { status: 'in_progress', conclusion: null, run_started_at: ago(5) }), run(1)])
    const list = document.querySelector('.steps')!
    expect(list.textContent).toContain('3 min so far')
    expect(list.querySelector('li.live')!.textContent).toContain('Refresh Pokémon')
    expect(list.textContent).toContain('waiting')
  })

  it('says when GitHub turns the page away', async () => {
    const { text } = await open([], 403)
    expect(text).toContain('GitHub limit reached')
  })

  it('allows the GitHub API in its policy', () => {
    expect(adminPage().headers.get('content-security-policy')).toContain(
      "connect-src 'self' https://api.github.com"
    )
  })
})
