import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import type { FriendCardCopies } from '@shared/types'
import { FriendCopies } from '@/features/friends/FriendCopies'
import { createMockApi, renderWithProviders } from './mockApi'

const bob: FriendCardCopies = {
  id: 2,
  username: 'bob',
  displayName: 'Bob',
  avatarUrl: null,
  quantity: 5,
  printings: [
    { setCode: 'LOB-005', rarity: 'Ultra Rare', language: 'en', quantity: 2 },
    { setCode: 'SDY-006', rarity: 'Ultra Rare', language: 'en', quantity: 1 },
    { setCode: 'DP-JP003', rarity: 'Rare', language: 'ja', quantity: 1 },
    { setCode: 'MRD-001', rarity: 'Rare', language: 'en', quantity: 1 }
  ]
}

function setup(
  forCard: (id: number) => Promise<FriendCardCopies[]>,
  user: { id: number } | null = { id: 1 }
): ReturnType<typeof vi.fn> {
  const spy = vi.fn(forCard)
  renderWithProviders(<FriendCopies cardId={7} />, {
    api: createMockApi({
      friends: { forCard: spy },
      account: { status: async () => ({ user }) as never }
    })
  })
  return spy
}

const section = (): HTMLElement | null =>
  screen.queryByRole('region', { name: 'Friends with this card' })

describe('FriendCopies', () => {
  it('names a code once when two finishes share it', async () => {
    const finish = { setCode: 'base1-4', language: 'en' as const, quantity: 1 }
    setup(async () => [
      {
        ...bob,
        printings: [
          { ...finish, rarity: 'Holofoil' },
          { ...finish, rarity: 'Reverse Holofoil' }
        ]
      }
    ])
    expect(await screen.findByText('base1-4')).toBeInTheDocument()
  })

  it('names each friend with their count and printings, once per card', async () => {
    const forCard = setup(async () => [bob])
    expect(await screen.findByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('×5')).toBeInTheDocument()
    expect(screen.getByText('LOB-005, SDY-006, DP-JP003 and 1 more')).toBeInTheDocument()
    expect(forCard).toHaveBeenCalledTimes(1)
    expect(forCard).toHaveBeenCalledWith(7)
  })

  it('asks nothing and shows nothing signed out', async () => {
    const forCard = setup(async () => [bob], null)
    await new Promise((r) => setTimeout(r, 20))
    expect(forCard).not.toHaveBeenCalled()
    expect(section()).not.toBeInTheDocument()
  })

  it('shows nothing when no friend has it', async () => {
    const forCard = setup(async () => [])
    await waitFor(() => expect(forCard).toHaveBeenCalled())
    expect(section()).not.toBeInTheDocument()
  })

  it('shows nothing on a portal without the call (404)', async () => {
    const forCard = setup(async () => {
      throw new Error('unknown-channel')
    })
    await waitFor(() => expect(forCard).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(forCard).toHaveBeenCalledTimes(1)
    expect(section()).not.toBeInTheDocument()
  })
})
