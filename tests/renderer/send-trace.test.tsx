import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountStatus } from '@shared/types'
import type { TraceRow, TraceSendState } from '@shared/traces'
import { SendTrace, sendText } from '@/features/scan/SendTrace'
import { ScanHubProvider } from '@/features/scan/ScanHub'
import { createMockApi, renderWithProviders } from './mockApi'

const seto = { id: 1, username: 'seto', displayName: 'Seto', avatarUrl: null }
const status = (extra: object = {}): AccountStatus => ({
  state: 'idle',
  user: { ...seto, ...extra },
  localOwner: 'Seto',
  lastSyncedAt: null,
  error: null,
  pendingCount: 0,
  unsyncedCount: 0,
  signInRequired: false
})
const wait = (ms = 20): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms))
  })

const SENT: TraceRow = {
  id: 4,
  game: 'ygo',
  session: '2026-11-25T10-00-00-000Z',
  note: 'Missed the Secret',
  appVersion: '0.122.0',
  files: 120,
  bytes: 42 * 1024 * 1024,
  createdAt: '2026-11-25T10:30:00.000Z',
  doneAt: '2026-11-25T10:31:00.000Z'
}

describe('SendTrace', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    window.api = undefined as never
  })

  it('is not there for an account that is not a trace tester', async () => {
    const api = createMockApi({ account: { status: vi.fn(async () => status()) } })
    renderWithProviders(<SendTrace />, { api })
    await wait()
    expect(screen.queryByRole('button', { name: /send trace/i })).toBeNull()
  })

  it("a trace tester sends this session's trace with what went wrong", async () => {
    let state: TraceSendState = { kind: 'idle' }
    const api = createMockApi({
      account: { status: vi.fn(async () => status({ traceTester: true })) },
      scan: {
        sendTrace: vi.fn(async () => (state = { kind: 'sending', sent: 0, total: 40 })),
        traceSendState: vi.fn(async () => state),
        sentTraces: vi.fn(async () => [SENT])
      }
    })
    renderWithProviders(<SendTrace />, { api })
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: 'Send trace' }))
    await u.type(screen.getByRole('textbox', { name: 'What went wrong?' }), 'Called it a Rare')
    await u.click(screen.getByRole('button', { name: 'Send this session' }))
    expect(api.scan.sendTrace).toHaveBeenCalledWith('Called it a Rare')
    expect(await screen.findByRole('status')).toHaveTextContent('Sending… 0 of 40 files')
    // It keeps asking how it's going, and says when it's done.
    state = { kind: 'sent', id: 9, files: 41 }
    await wait(1200)
    expect(screen.getByRole('status')).toHaveTextContent('Sent, thanks! 41 files went up.')
    const list = within(screen.getByRole('region', { name: 'Sent traces' }))
    expect(list.getByText(/Missed the Secret/)).toBeInTheDocument()
    expect(list.getByText('42.0 MB')).toBeInTheDocument()
    await u.click(list.getByRole('button', { name: /Delete the trace sent/ }))
    expect(api.scan.deleteTrace).toHaveBeenCalledWith(4)
  })

  it('words every way a send can fail', () => {
    for (const reason of ['no-trace', 'daily-cap', 'signed-out', 'not-allowed', 'offline'] as const)
      expect(sendText({ kind: 'failed', reason })).toBeTruthy()
  })

  it("turns the scan trace on for a trace tester, so there's one to send", async () => {
    const api = createMockApi({
      account: { status: vi.fn(async () => status({ traceTester: true })) }
    })
    renderWithProviders(<ScanHubProvider>{null}</ScanHubProvider>, { api })
    await wait(50)
    expect(localStorage.getItem('scan.trace')).toBe('1')
  })
})
