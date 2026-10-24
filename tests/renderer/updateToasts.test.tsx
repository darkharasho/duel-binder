import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import type { UpdateStatus } from '@shared/types'
import { useUpdateToasts } from '@/features/settings/useUpdateToasts'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { createMockApi, renderWithProviders } from './mockApi'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }), Toaster: () => null }))

function Host(): null {
  useUpdateToasts()
  return null
}

const ready: UpdateStatus = { state: 'ready', mode: 'auto', version: '1.2.0', error: null }

describe('useUpdateToasts', () => {
  beforeEach(() => vi.mocked(toast).mockClear())

  it('emitting ready twice yields one toast', async () => {
    let push: (s: UpdateStatus) => void = () => {}
    const api = createMockApi({ app: { onUpdateStatus: vi.fn((cb) => ((push = cb), () => {})) } })
    renderWithProviders(<Host />, { api })
    await waitFor(() => expect(api.app.updateStatus).toHaveBeenCalled())
    act(() => push(ready))
    act(() => push({ ...ready }))
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    expect(vi.mocked(toast).mock.calls[0][1]).toMatchObject({ id: 'app-update' })
  })

  it('seeded status from updateStatus() shows the notify toast', async () => {
    const api = createMockApi({
      app: { updateStatus: vi.fn(async () => ({ state: 'available' as const, mode: 'notify' as const, version: '1.3.0', error: null })) }
    })
    renderWithProviders(<Host />, { api })
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Update 1.3.0 available', expect.anything()))
  })
})

describe('SettingsPage update actions', () => {
  it('shows Download in notify mode and Restart now when ready', async () => {
    const user = userEvent.setup()
    const api = createMockApi({
      app: { updateStatus: vi.fn(async () => ({ state: 'available' as const, mode: 'notify' as const, version: '1.3.0', error: null })) }
    })
    const { unmount } = renderWithProviders(<SettingsPage />, { api })
    await user.click(await screen.findByRole('button', { name: 'Download' }))
    expect(api.app.applyUpdate).toHaveBeenCalledTimes(1)
    unmount()
    const api2 = createMockApi({ app: { updateStatus: vi.fn(async () => ready) } })
    renderWithProviders(<SettingsPage />, { api: api2 })
    await user.click(await screen.findByRole('button', { name: 'Restart now' }))
    expect(api2.app.applyUpdate).toHaveBeenCalledTimes(1)
  })
})
