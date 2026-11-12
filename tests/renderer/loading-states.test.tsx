import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Api } from '@shared/ipc'
import type { BrowseCard } from '@shared/types'
import { CardSheet } from '@/components/CardSheet'
import { BindersPage } from '@/features/binders/BindersPage'
import { BrowsePage } from '@/features/browse/BrowsePage'
import { CardPanel } from '@/features/card/CardPanel'
import { CollectionPage } from '@/features/collection/CollectionPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { FriendsPage } from '@/features/friends/FriendsPage'
import { SetChecklist } from '@/features/sets/SetChecklist'
import { SetsPage } from '@/features/sets/SetsPage'
import { WishlistPage } from '@/features/wishlist/WishlistPage'
import { GameProvider } from '@/lib/game'
import { createMockApi, renderWithProviders, type DeepPartial } from './mockApi'

/** A call that never answers: the page stays in its loading state for the whole test. */
const never = <T,>(): (() => Promise<T>) => vi.fn(() => new Promise<T>(() => {}))

/** Texts a page must never show while its data is still on the way. */
const EMPTY_TEXT = [
  /\b0 (cards|entries|sets)\b/,
  /No options/,
  /none yet/i,
  /No data yet/,
  /No cards yet/,
  /No binders yet/,
  /No friends yet/,
  /Nothing here yet/,
  /\$0\.00/,
  /No sets match/,
  /No cards match/,
  /Prices updated never/
]

function expectNoEmptyText(): void {
  const text = document.body.textContent ?? ''
  for (const re of EMPTY_TEXT) expect(text).not.toMatch(re)
}

const pendingApi = (over: DeepPartial<Api> = {}): Api =>
  createMockApi({
    stats: { get: never() },
    collection: { list: never(), facets: never(), forCard: never() },
    cards: { browse: never(), browseFacets: never(), get: never() },
    sets: { list: never(), checklist: never() },
    binders: { list: never() },
    wishlist: { list: never() },
    favourites: { list: never() },
    ...over
  })

afterEach(() => {
  window.api = undefined as never
  localStorage.clear()
})

describe('loading states', () => {
  it('the dashboard shows a skeleton, not an empty collection, while its stats load', async () => {
    renderWithProviders(<DashboardPage onNavigate={() => {}} />, { api: pendingApi() })
    expect(await screen.findByRole('status', { name: /Loading your collection/ })).toBeVisible()
    expect(screen.queryByText("What's in your binder?")).not.toBeInTheDocument()
    expectNoEmptyText()
  })

  it('the collection shows a loading grid and no count while its cards load', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CollectionPage />, { api: pendingApi() })
    expect(await screen.findByRole('status', { name: 'Loading your cards' })).toBeVisible()
    expect(screen.getByText('Loading cards…')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Filters' }))
    expect((await screen.findAllByText('Loading options…')).length).toBeGreaterThan(0)
    expectNoEmptyText()
  })

  it('browse shows a loading grid and loading filter options', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BrowsePage onAddCard={() => {}} />, { api: pendingApi() })
    expect(await screen.findByRole('status', { name: 'Loading cards' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Filters' }))
    expect((await screen.findAllByText('Loading options…')).length).toBeGreaterThan(0)
    expectNoEmptyText()
  })

  it("a clicked owned card in Browse shows it's opening while its copies load", async () => {
    const user = userEvent.setup()
    const card = {
      id: 7,
      name: 'Dark Magician',
      type: 'Normal Monster',
      race: 'Spellcaster',
      atk: 2500,
      def: 2100,
      level: 7,
      linkval: null,
      imageId: 7,
      price: 1,
      releasedAt: '2002-03-08',
      owned: 1,
      defaultPrintingId: 1
    } as unknown as BrowseCard
    renderWithProviders(<BrowsePage onAddCard={() => {}} />, {
      api: pendingApi({ cards: { browse: async () => ({ cards: [card], total: 1 }) } })
    })
    const tile = await screen.findByRole('button', { name: /^Dark Magician/ })
    await user.click(tile)
    expect(tile).toHaveAttribute('aria-busy', 'true')
  })

  it('the sets page shows loading rows and no set count while the list loads', async () => {
    renderWithProviders(<SetsPage onAddCard={() => {}} onAddMissing={() => {}} />, {
      api: pendingApi()
    })
    expect(await screen.findByText('Loading sets…')).toBeVisible()
    expect(screen.getByRole('status', { name: 'Loading sets' })).toBeVisible()
    expectNoEmptyText()
  })

  it('a set checklist shows a loading grid while the set loads', async () => {
    renderWithProviders(
      <SetChecklist
        setName="Metal Raiders"
        language="en"
        mode="cards"
        onModeChange={() => {}}
        onBack={() => {}}
        onAddMissing={() => {}}
      />,
      { api: pendingApi() }
    )
    expect(await screen.findByRole('status', { name: 'Loading the set' })).toBeVisible()
    expectNoEmptyText()
  })

  it('the card panel shows a spinner, not "You have none yet", while the card loads', async () => {
    renderWithProviders(
      <GameProvider>
        <CardSheet onClose={() => {}}>
          <CardPanel cardId={1} onClose={() => {}} />
        </CardSheet>
      </GameProvider>,
      { api: pendingApi() }
    )
    expect(await screen.findByText('Loading printings…')).toBeVisible()
    expectNoEmptyText()
  })

  it('binders, the wishlist and friends show loading shapes, not their empty messages', async () => {
    const api = pendingApi({ window: { platform: 'web' }, friends: { overview: never() } })
    const binders = renderWithProviders(<BindersPage />, { api })
    expect(await screen.findByRole('status', { name: 'Loading binders' })).toBeVisible()
    expectNoEmptyText()
    binders.unmount()

    const wishlist = renderWithProviders(<WishlistPage />, { api })
    expect(await screen.findByRole('status', { name: 'Loading your wishlist' })).toBeVisible()
    expectNoEmptyText()
    wishlist.unmount()

    renderWithProviders(<FriendsPage />, { api })
    await waitFor(() => expect(api.friends.overview).toHaveBeenCalled())
    expect(await screen.findByRole('status', { name: 'Loading friends' })).toBeVisible()
    expectNoEmptyText()
  })
})
