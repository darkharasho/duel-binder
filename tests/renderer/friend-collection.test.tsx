import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import type { CardRow, EntryView, Friend, Printing } from '@shared/types'
import { CollectionPage } from '@/features/collection/CollectionPage'
import { FriendsPage } from '@/features/friends/FriendsPage'
import { createMockApi, renderWithProviders } from './mockApi'

const card = (id: number, name: string): CardRow => ({
  id,
  name,
  type: 'Normal Monster',
  frameType: 'normal',
  race: 'Spellcaster',
  attribute: 'DARK',
  level: 7,
  linkval: null,
  atk: 2500,
  def: 2100,
  archetype: null,
  desc: 'A wizard.',
  tcgplayerPrice: 1
})
const printing = (id: number, cardId: number, extra: Partial<Printing> = {}): Printing => ({
  id,
  cardId,
  setName: 'Legend of Blue Eyes',
  setCode: `LOB-EN00${id}`,
  setRarity: 'Ultra Rare',
  setRarityCode: '(UR)',
  language: 'en',
  setPrice: 10,
  missingFromApi: false,
  ...extra
})
const entry = (id: number, name: string, extra: Partial<EntryView> = {}): EntryView => ({
  id,
  quantity: 2,
  notes: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  card: card(100 + id, name),
  printing: printing(id, 100 + id),
  imageId: 100 + id,
  originalArt: true,
  unitPrice: 10,
  priceApproximate: false,
  priceSource: 'ygoprodeck',
  priceCheckedAt: null,
  priceListingCount: null,
  noPriceReason: null,
  totalValue: 20,
  ...extra
})

const friend: Friend = {
  id: 7,
  username: 'bob',
  displayName: 'Bob',
  avatarUrl: null,
  cardCount: 3,
  updatedAt: null
}
const kuriboh = entry(1, 'Kuriboh')
const mine = entry(2, 'Blue-Eyes White Dragon')

const make = (friendEntries: EntryView[] = [kuriboh]): ReturnType<typeof createMockApi> =>
  createMockApi({
    window: { platform: 'web' },
    friends: {
      overview: vi.fn(async () => ({ friends: [friend], incoming: [] })),
      collection: vi.fn(async () => friendEntries)
    },
    collection: { list: vi.fn(async () => [mine]), forCard: vi.fn(async () => []) }
  })

afterEach(() => {
  window.api = undefined as never
})

describe('friend collection', () => {
  it('reads from the friend endpoints only', async () => {
    const api = make()
    renderWithProviders(<CollectionPage friend={friend} onBackToMine={() => {}} />, { api })
    expect(await screen.findByText('Kuriboh')).toBeInTheDocument()
    expect(api.friends.collection).toHaveBeenCalledWith(7, expect.anything())
    expect(api.friends.facets).toHaveBeenCalledWith(7)
    expect(api.collection.list).not.toHaveBeenCalled()
    expect(api.collection.facets).not.toHaveBeenCalled()
    expect(api.stats.get).not.toHaveBeenCalled()
    expect(screen.getByText(/1 entry$/)).toBeInTheDocument()
  })

  it('shows the heading and a banner with Back to mine', async () => {
    const onBack = vi.fn()
    renderWithProviders(<CollectionPage friend={friend} onBackToMine={onBack} />, { api: make() })
    expect(await screen.findByRole('heading', { name: "Bob's collection" })).toBeInTheDocument()
    expect(screen.getByText("Viewing Bob's collection")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back to mine' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('has no Add card button, even when empty', async () => {
    renderWithProviders(
      <CollectionPage friend={{ ...friend, cardCount: 0 }} onBackToMine={() => {}} />,
      { api: make([]) }
    )
    expect(await screen.findByText("Bob hasn't added any cards yet")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add card' })).not.toBeInTheDocument()
  })

  it('shows an error with Retry when the friend collection fails to load', async () => {
    const collection = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Error invoking remote method 'friends:collection': Error: You're offline.")
      )
      .mockResolvedValue([kuriboh])
    const api = createMockApi({
      window: { platform: 'web' },
      friends: { collection },
      collection: { list: vi.fn(async () => [mine]), forCard: vi.fn(async () => []) }
    })
    renderWithProviders(<CollectionPage friend={friend} onBackToMine={() => {}} />, { api })
    expect(await screen.findByRole('alert')).toHaveTextContent("You're offline.")
    expect(screen.queryByText("Bob hasn't added any cards yet")).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Kuriboh')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('opens a read-only detail panel', async () => {
    const api = make([kuriboh, entry(3, 'Kuriboh', { card: kuriboh.card })])
    renderWithProviders(<CollectionPage friend={friend} onBackToMine={() => {}} />, { api })
    await userEvent.click((await screen.findAllByText('Kuriboh'))[0])
    expect(await screen.findByText('Their copies')).toBeInTheDocument()
    expect(screen.getAllByText('Kuriboh').length).toBeGreaterThan(0)
    expect(screen.getByText('Value')).toBeInTheDocument()
    expect(screen.queryByLabelText('Quantity')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: /Artwork/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Printing')).not.toBeInTheDocument()
    expect(api.collection.forCard).not.toHaveBeenCalled()
  })

  it('lists all their copies of a card, even ones the filters hide', async () => {
    const second = entry(3, 'Kuriboh', { card: kuriboh.card })
    const api = createMockApi({
      window: { platform: 'web' },
      friends: {
        collection: vi.fn(async (_id: number, f: { q?: string }) =>
          f.q ? [kuriboh] : [kuriboh, second]
        )
      }
    })
    renderWithProviders(<CollectionPage friend={friend} onBackToMine={() => {}} />, { api })
    await screen.findAllByText('Kuriboh')
    await userEvent.type(screen.getByLabelText('Search collection'), 'LOB-EN001')
    await waitFor(() => expect(screen.getAllByText('Kuriboh')).toHaveLength(1))
    await userEvent.click(screen.getByText('Kuriboh'))
    const copies = await screen.findByRole('region', { name: 'Their copies' })
    await waitFor(() => expect(within(copies).getByText(/LOB-EN003/)).toBeInTheDocument())
    // Picking the hidden copy keeps the panel open on it.
    await userEvent.click(within(copies).getByText(/LOB-EN003/))
    expect(
      within(copies)
        .getByText(/LOB-EN003/)
        .closest('button')
    ).toHaveAttribute('aria-current', 'true')
  })

  it('keeps the cards shown when a background refresh fails', async () => {
    const collection = vi
      .fn()
      .mockResolvedValueOnce([kuriboh])
      .mockRejectedValue(new Error("You're offline."))
    const api = createMockApi({ window: { platform: 'web' }, friends: { collection } })
    const { client } = renderWithProviders(
      <CollectionPage friend={friend} onBackToMine={() => {}} />,
      { api }
    )
    expect(await screen.findByText('Kuriboh')).toBeInTheDocument()
    await act(() => client.refetchQueries({ queryKey: ['friends', 7, 'entries'] }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn't refresh.*You're offline/)
    expect(screen.getByText('Kuriboh')).toBeInTheDocument()
  })

  it('passes search filters to the friend endpoint', async () => {
    const api = make()
    renderWithProviders(<CollectionPage friend={friend} onBackToMine={() => {}} />, { api })
    await screen.findByText('Kuriboh')
    await userEvent.type(screen.getByLabelText('Search collection'), 'kur')
    await waitFor(() =>
      expect(api.friends.collection).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ q: expect.stringContaining('kur') })
      )
    )
  })

  it("does not leak the friend's entries into your own collection", async () => {
    const api = make()
    const { client, unmount } = renderWithProviders(
      <CollectionPage friend={friend} onBackToMine={() => {}} />,
      { api }
    )
    expect(await screen.findByText('Kuriboh')).toBeInTheDocument()
    unmount()
    render(
      <QueryClientProvider client={client}>
        <CollectionPage />
      </QueryClientProvider>
    )
    expect(await screen.findByText('Blue-Eyes White Dragon')).toBeInTheDocument()
    expect(screen.queryByText('Kuriboh')).not.toBeInTheDocument()
  })

  it("opens a friend's collection from FriendsPage", async () => {
    const onBack = vi.fn()
    renderWithProviders(<FriendsPage onBackToMine={onBack} />, { api: make() })
    await userEvent.click(await screen.findByText('Bob'))
    expect(await screen.findByRole('heading', { name: "Bob's collection" })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back to mine' }))
    expect(onBack).toHaveBeenCalled()
  })
})
