import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import type { CardDetail, CardRow, FriendWantsCard, Printing, WishlistItem } from '@shared/types'
import { CardSheet } from '@/components/CardSheet'
import { CardPanel } from '@/features/card/CardPanel'
import { FriendsPage } from '@/features/friends/FriendsPage'
import { WishlistToggle } from '@/features/settings/WishlistToggle'
import { WishlistPage } from '@/features/wishlist/WishlistPage'
import { invalidateAfterEdit, mutationInvalidationKeys, queryKeys } from '@/lib/api'
import { GameProvider } from '@/lib/game'
import { stillWanted, wishlistCost } from '@/lib/wishlist'
import { createMockApi, renderWithProviders } from './mockApi'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

const card = { id: 1, name: 'Dark Magician', type: 'Normal Monster' } as CardRow
const printing = (id: number, extra: Partial<Printing> = {}): Printing => ({
  id,
  cardId: 1,
  setName: 'Legend of Blue Eyes',
  setCode: `LOB-00${id}`,
  setRarity: 'Ultra Rare',
  setRarityCode: '(UR)',
  language: 'en',
  setPrice: 5,
  missingFromApi: false,
  ...extra
})
const item = (id: number, extra: Partial<WishlistItem> = {}): WishlistItem => ({
  pkey: `en|1|LOB-00${id}|Ultra Rare`,
  card,
  printing: printing(id),
  imageId: 100,
  printingScan: true,
  quantity: null,
  owned: 0,
  unitPrice: 10,
  priceApproximate: false,
  addedAt: '2026-10-01T00:00:00.000Z',
  ...extra
})
const signedIn = { account: { status: async () => ({ user: { id: 1 } }) as never } }
const bob = { id: 2, username: 'bob', displayName: 'Bob', avatarUrl: null }

const detail = (printings: Printing[]): CardDetail => ({
  card,
  printings,
  images: [{ imageId: 100, cardId: 1, sortOrder: 0 }]
})

function panel(
  api: Parameters<typeof createMockApi>[0] = {},
  copies: unknown[] = []
): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <GameProvider>
      <CardSheet onClose={() => {}}>
        <CardPanel cardId={1} onClose={() => {}} />
      </CardSheet>
    </GameProvider>,
    {
      api: createMockApi({
        ...api,
        cards: { get: async () => detail([printing(1), printing(2)]) },
        collection: { forCard: async () => copies as never },
        ...signedIn
      })
    }
  )
}

describe('wishlist helpers', () => {
  it('counts what is left to get', () => {
    expect(stillWanted({ quantity: null, owned: 0 })).toBe(1)
    expect(stillWanted({ quantity: null, owned: 2 })).toBe(0)
    expect(stillWanted({ quantity: 3, owned: 1 })).toBe(2)
    expect(stillWanted({ quantity: 1, owned: 4 })).toBe(0)
  })

  it('totals only what is left, and counts the unpriced apart', () => {
    expect(
      wishlistCost([
        item(1, { quantity: 3, owned: 1, unitPrice: 10 }),
        item(2, { owned: 1, unitPrice: 100 }),
        item(3, { unitPrice: null })
      ])
    ).toEqual({ cost: 20, unpriced: 1 })
  })

  it('every edit refreshes the wishlist', async () => {
    expect(mutationInvalidationKeys).toContainEqual(['wishlist'])
    const qc = { invalidateQueries: vi.fn(async () => {}) }
    await invalidateAfterEdit(qc as never)
    expect(qc.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['wishlist'] })
    )
    expect(queryKeys.wishlistForCard(1)[0]).toBe('wishlist')
  })
})

describe('the heart on a card type', () => {
  it('wants the printing, and takes it back', async () => {
    let wished: { printingId: number; quantity: null }[] = []
    const set = vi.fn(async (printingId: number) => {
      wished = [{ printingId, quantity: null }]
    })
    const remove = vi.fn(async () => {
      wished = []
    })
    panel({ wishlist: { set, remove, forCard: async () => wished } })
    const heart = await screen.findByRole('button', {
      name: 'Want Dark Magician LOB-001 Ultra Rare'
    })
    expect(heart).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(heart)
    expect(set).toHaveBeenCalledWith(1, null)
    await waitFor(() => expect(heart).toHaveAttribute('aria-pressed', 'true'))
    await userEvent.click(heart)
    expect(remove).toHaveBeenCalledWith(1)
    await waitFor(() => expect(heart).toHaveAttribute('aria-pressed', 'false'))
  })

  it('shows a printing already wanted, on that row only', async () => {
    panel({ wishlist: { forCard: async () => [{ printingId: 2, quantity: null }] } })
    const wanted = await screen.findByRole('button', { name: /LOB-002/, pressed: true })
    expect(wanted).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Want .*LOB-001/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  it('rolls back and tells the user when the write fails', async () => {
    const set = vi.fn(async () => {
      throw new Error('nope')
    })
    panel({ wishlist: { set } })
    const heart = await screen.findByRole('button', { name: /Want .*LOB-001/ })
    await userEvent.click(heart)
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    await waitFor(() => expect(heart).toHaveAttribute('aria-pressed', 'false'))
  })
})

describe('X wants this', () => {
  const wants: FriendWantsCard = {
    ...bob,
    printings: [{ setCode: 'LOB-001', rarity: 'Ultra Rare', language: 'en' }]
  }
  const copy = {
    id: 9,
    quantity: 1,
    notes: '',
    card,
    printing: printing(1),
    imageId: 100,
    printingScan: true,
    unitPrice: 1,
    noPriceReason: null
  }

  it('names friends who want a card you own', async () => {
    const wanting = vi.fn(async () => [wants])
    panel({ friends: { wanting } }, [copy])
    expect(await screen.findByText('Bob wants this')).toBeInTheDocument()
    expect(wanting).toHaveBeenCalledTimes(1)
  })

  it('does not ask for a card you do not own', async () => {
    const wanting = vi.fn(async () => [wants])
    panel({ friends: { wanting } })
    await screen.findByRole('button', { name: /Want .*LOB-001/ })
    expect(wanting).not.toHaveBeenCalled()
  })

  it('the panel shows at once and stays quiet when the portal has no such call', async () => {
    const wanting = vi.fn(async () => {
      throw new Error('unknown-channel')
    })
    panel({ friends: { wanting } }, [copy])
    expect(await screen.findByRole('button', { name: /Want .*LOB-001/ })).toBeInTheDocument()
    await waitFor(() => expect(wanting).toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: 'Friends who want this card' })).toBeNull()
  })
})

describe('WishlistPage', () => {
  const page = (api: Parameters<typeof createMockApi>[0]): void => {
    renderWithProviders(
      <GameProvider>
        <WishlistPage />
      </GameProvider>,
      { api: createMockApi({ ...api, ...signedIn }) }
    )
  }

  it('lists wants with their price, the total, and which a friend owns, in one request', async () => {
    const owning = vi.fn(async () => [{ pkey: item(1).pkey, friends: [{ ...bob, quantity: 2 }] }])
    page({
      wishlist: { list: async () => [item(1, { quantity: 2 }), item(2, { unitPrice: null })] },
      friends: { owning }
    })
    expect(
      await screen.findByText('2 cards · $20.00 to get · 1 without a price')
    ).toBeInTheDocument()
    expect(await screen.findByText('Bob has this')).toBeInTheDocument()
    expect(owning).toHaveBeenCalledTimes(1)
    expect(owning).toHaveBeenCalledWith([item(1).pkey, item(2).pkey])
  })

  it('marks a want as owned, and how far along a target is', async () => {
    page({
      wishlist: { list: async () => [item(1, { owned: 1 }), item(2, { quantity: 3, owned: 1 })] }
    })
    expect(await screen.findByText('Owned')).toBeInTheDocument()
    expect(screen.getByText('1 of 3 owned')).toBeInTheDocument()
    expect(screen.getByText('2 cards · $20.00 to get')).toBeInTheDocument()
  })

  it('removes a want, and steps its target down to no target', async () => {
    const remove = vi.fn(async () => undefined)
    const set = vi.fn(async () => undefined)
    page({
      wishlist: {
        list: async () => [item(1, { quantity: 2, owned: 1 }), item(2)],
        remove,
        set
      }
    })
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Remove Dark Magician LOB-002 Ultra Rare from wishlist'
      })
    )
    expect(remove).toHaveBeenCalledWith(2)
    await userEvent.click(
      screen.getByRole('button', { name: 'Want fewer Dark Magician LOB-001 Ultra Rare' })
    )
    expect(set).toHaveBeenCalledWith(1, null)
    await userEvent.click(
      screen.getByRole('button', { name: 'Want more Dark Magician LOB-002 Ultra Rare' })
    )
    expect(set).toHaveBeenCalledWith(2, 1)
  })

  it('says how to start when empty, with no friend request', async () => {
    const owning = vi.fn(async () => [])
    page({ friends: { owning } })
    expect(await screen.findByText(/press the heart/)).toBeInTheDocument()
    expect(owning).not.toHaveBeenCalled()
  })

  it('an old portal costs only the friend line, with no error toast', async () => {
    vi.mocked(toast.error).mockClear()
    const owning = vi.fn(async () => {
      throw new Error('unknown-channel')
    })
    page({ wishlist: { list: async () => [item(1)] }, friends: { owning } })
    expect(await screen.findByText('Dark Magician')).toBeInTheDocument()
    await waitFor(() => expect(owning).toHaveBeenCalled())
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe("a friend's binder", () => {
  const overview = {
    friends: [{ ...bob, cardCount: 1, updatedAt: null }],
    incoming: [],
    blocked: []
  }
  const openBinder = async (
    wishlist: () => Promise<WishlistItem[]>,
    get: () => Promise<CardDetail> = async () => detail([printing(1)])
  ): Promise<void> => {
    renderWithProviders(
      <GameProvider>
        <FriendsPage onBackToMine={() => {}} />
      </GameProvider>,
      {
        api: createMockApi({
          friends: { overview: async () => overview, wishlist },
          cards: { get },
          ...signedIn
        })
      }
    )
    await userEvent.click(await screen.findByRole('button', { name: /@bob/ }))
    await userEvent.click(await screen.findByRole('radio', { name: 'Wishlist' }))
  }

  it('has their wishlist, read-only', async () => {
    await openBinder(async () => [item(1)])
    expect(await screen.findByRole('heading', { name: "Bob's wishlist" })).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Wanted cards' })
    expect(within(list).getByText('Dark Magician')).toBeInTheDocument()
    expect(within(list).queryByRole('button', { name: /Remove/ })).toBeNull()
    expect(within(list).queryByRole('button', { name: /Want more/ })).toBeNull()
  })

  it("opens the card on the printing they want, whatever this catalog's id for it", async () => {
    const theirs = item(2, {
      printingScan: false,
      printing: { ...printing(2), id: 7002 }
    })
    await openBinder(
      async () => [theirs],
      async () => detail([printing(1), printing(2), printing(3)])
    )
    const list = await screen.findByRole('list', { name: 'Wanted cards' })
    await userEvent.click(within(list).getByRole('button', { name: /Dark Magician/ }))
    await waitFor(() => expect(document.querySelector('[aria-current="true"]')).not.toBeNull())
    expect(document.querySelector('[aria-current="true"]')).toHaveTextContent('LOB-002')
  })

  it('a hidden list reads as an empty one, and a failure too', async () => {
    await openBinder(async () => [])
    expect(await screen.findByText('Bob has no wishlist to show.')).toBeInTheDocument()
  })

  it('a portal without the call shows the same line', async () => {
    await openBinder(async () => {
      throw new Error('unknown-channel')
    })
    expect(await screen.findByText('Bob has no wishlist to show.')).toBeInTheDocument()
  })
})

describe('WishlistToggle', () => {
  it('is on by default and turns off', async () => {
    const setWishlistVisible = vi.fn(async () => undefined)
    renderWithProviders(<WishlistToggle />, {
      api: createMockApi({ friends: { setWishlistVisible }, ...signedIn })
    })
    const box = await screen.findByRole('checkbox', { name: /Show my wishlist to friends/ })
    expect(box).toBeChecked()
    await userEvent.click(box)
    expect(setWishlistVisible).toHaveBeenCalledWith(false)
  })

  it('is not there signed out, or on a portal without it', async () => {
    const wishlistVisible = vi.fn(async () => {
      throw new Error('unknown-channel')
    })
    renderWithProviders(<WishlistToggle />, {
      api: createMockApi({ friends: { wishlistVisible }, ...signedIn })
    })
    await waitFor(() => expect(wishlistVisible).toHaveBeenCalled())
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})
