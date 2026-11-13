import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountStatus } from '@shared/types'
import { ScanTraceToggle } from '@/features/scan/ScanTraceToggle'
import { createMockApi, renderWithProviders } from './mockApi'

const seto = { id: 1, username: 'seto', displayName: 'Seto', avatarUrl: null }
const status = (admin: boolean): AccountStatus => ({
  state: 'idle',
  user: admin ? { ...seto, admin: true } : seto,
  localOwner: 'Seto',
  lastSyncedAt: null,
  error: null,
  pendingCount: 0,
  unsyncedCount: 0,
  signInRequired: false
})

describe('ScanTraceToggle', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    window.api = undefined as never
  })

  it('hidden for non-admins', async () => {
    const api = createMockApi({ account: { status: vi.fn(async () => status(false)) } })
    renderWithProviders(<ScanTraceToggle />, { api })
    // Give the account status a moment to arrive.
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole('button', { name: /scan trace/i })).toBeNull()
  })

  it('admin toggles and sees the folder', async () => {
    const api = createMockApi({ account: { status: vi.fn(async () => status(true)) } })
    renderWithProviders(<ScanTraceToggle />, { api })
    const button = await screen.findByRole('button', { name: 'Scan trace off' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(button)
    expect(localStorage.getItem('scan.trace')).toBe('1')
    expect(screen.getByRole('button', { name: 'Scan trace on' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(
      await screen.findByText('/home/me/.config/duel-binder/scan-trace', { exact: false })
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open folder' }))
    expect(api.scan.openTraceDir).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Scan trace on' }))
    expect(localStorage.getItem('scan.trace')).toBeNull()
  })
})
