import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import type { Api } from '@shared/ipc'
import type { ScanSession } from '@shared/scanSessions'
import { SessionsPage } from '@/features/sessions/SessionsPage'
import { SessionsSheet } from '../../src/phone/SessionsSheet'
import { handleBack } from '../../src/phone/backButton'
import { createMockApi, renderWithProviders } from './mockApi'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const session: ScanSession = {
  uid: 's1',
  game: 'ygo',
  cards: [
    {
      cardId: 7,
      pkey: 'en|7|SDY-006|Ultra Rare',
      printingId: 70,
      imageId: 700,
      photoId: null,
      name: 'Dark Magician',
      setCode: 'SDY-006',
      rarity: 'Ultra Rare',
      quantity: 1,
      price: 2,
      guess: false,
      addedAt: 1
    }
  ],
  friendsVisible: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
}
const api = (): Api => createMockApi({ sessions: { list: vi.fn(async () => [session]) } })

describe('SessionsPage', () => {
  it('lists the current game sessions', async () => {
    const a = api()
    renderWithProviders(<SessionsPage />, { api: a })
    expect(await screen.findByRole('button', { name: 'Dark Magician' })).toBeInTheDocument()
    expect(a.sessions.list).toHaveBeenCalledWith('ygo')
    expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument()
  })

  it('opens the card sheet when a tile is clicked', async () => {
    const a = api()
    renderWithProviders(<SessionsPage />, { api: a })
    await userEvent.click(await screen.findByRole('button', { name: /Dark Magician/ }))
    await waitFor(() => expect(a.cards.get).toHaveBeenCalledWith(7))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})

describe('SessionsSheet', () => {
  it('shows the sessions and closes on back', async () => {
    const onClose = vi.fn()
    renderWithProviders(<SessionsSheet game="ygo" onClose={onClose} />, { api: api() })
    expect(await screen.findByRole('button', { name: 'Dark Magician' })).toBeInTheDocument()
    expect(handleBack()).toBe(true)
    expect(onClose).toHaveBeenCalled()
  })
})
