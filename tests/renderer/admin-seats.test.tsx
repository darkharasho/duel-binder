import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AdminSeats } from '@shared/admin'
import { SeatsTab } from '@/features/admin/SeatsTab'
import { createMockApi, renderWithProviders } from './mockApi'
import { toast } from 'sonner'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

afterEach(() => {
  window.api = undefined as never
})

const SEATS: AdminSeats = {
  counts: { cap: 100, accounts: 90, invited: 2, free: 8, waiting: 3 },
  waitlist: [
    {
      id: 1,
      email: 'wait@example.com',
      createdAt: '2026-11-20T10:00:00.000Z',
      invitedAt: null,
      inviteExpiresAt: null,
      status: 'waiting'
    },
    {
      id: 2,
      email: 'sent@example.com',
      createdAt: '2026-11-19T10:00:00.000Z',
      invitedAt: '2026-11-20T10:00:00.000Z',
      inviteExpiresAt: '2026-11-27T10:00:00.000Z',
      status: 'invited'
    },
    {
      id: 3,
      email: 'in@example.com',
      createdAt: '2026-11-18T10:00:00.000Z',
      invitedAt: '2026-11-19T10:00:00.000Z',
      inviteExpiresAt: '2026-11-26T10:00:00.000Z',
      status: 'joined'
    }
  ]
}

function setup(reply: (req: unknown) => Promise<object> = async () => ({})): {
  seatsAction: ReturnType<typeof vi.fn>
} {
  const seatsAction = vi.fn(reply)
  const api = createMockApi({ window: { platform: 'linux' } })
  api.admin = { seats: vi.fn(async () => SEATS), seatsAction } as never
  renderWithProviders(<SeatsTab seats={SEATS} />, { api })
  return { seatsAction }
}

describe('admin Seats tab', () => {
  it('says when a fill left people waiting for another press', async () => {
    setup(async () => ({ invited: 25, left: 4 }))
    await userEvent.click(screen.getByRole('button', { name: 'Fill open seats' }))
    await waitFor(() =>
      expect(toast.success).toHaveBeenLastCalledWith(
        'Invited 25 from the waitlist. 4 more can be invited: press Fill open seats again.'
      )
    )
  })

  it('shows the already-has-an-account message when cancel is refused', async () => {
    setup(async (req) => {
      if ((req as { action: string }).action === 'cancel')
        throw new Error('That person already has an account.')
      return {}
    })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel invite' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel invite' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'That person already has an account.'
    )
  })

  it('shows the counts and the waitlist', () => {
    setup()
    expect(screen.getByText(/used 90 of 100/)).toHaveTextContent(
      'used 90 of 100 · invited 2 · free 8 · waiting 3'
    )
    expect(screen.getByText('wait@example.com')).toBeInTheDocument()
    expect(screen.getByText('Waiting')).toBeInTheDocument()
    expect(screen.getByText(/^Invited until/)).toBeInTheDocument()
    expect(screen.getByText('Joined')).toBeInTheDocument()
  })

  it('saves the cap and fills seats', async () => {
    const { seatsAction } = setup()
    const input = screen.getByRole('spinbutton', { name: 'Seat cap' })
    await userEvent.clear(input)
    await userEvent.type(input, '150')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(seatsAction).toHaveBeenLastCalledWith({ action: 'cap', cap: 150 }))
    await userEvent.click(screen.getByRole('button', { name: 'Fill open seats' }))
    await waitFor(() => expect(seatsAction).toHaveBeenLastCalledWith({ action: 'fill' }))
  })

  it('invites, resends and cancels an entry, and deletes with a confirm', async () => {
    const { seatsAction } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Invite now' }))
    await waitFor(() => expect(seatsAction).toHaveBeenLastCalledWith({ action: 'invite', id: 1 }))
    await userEvent.click(screen.getByRole('button', { name: 'Resend' }))
    await waitFor(() => expect(seatsAction).toHaveBeenLastCalledWith({ action: 'resend', id: 2 }))

    await userEvent.click(screen.getByRole('button', { name: 'Cancel invite' }))
    const cancel = await screen.findByRole('dialog')
    await userEvent.click(within(cancel).getByRole('button', { name: 'Cancel invite' }))
    await waitFor(() => expect(seatsAction).toHaveBeenLastCalledWith({ action: 'cancel', id: 2 }))

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const del = await screen.findByRole('dialog')
    await userEvent.click(within(del).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(seatsAction).toHaveBeenLastCalledWith({ action: 'delete', id: 1 }))
  })
})
