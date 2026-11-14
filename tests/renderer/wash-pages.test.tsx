import { screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import type {
  BinderCard,
  BinderDetail,
  BinderSummary,
  CardRow,
  Printing,
  WishlistItem
} from '@shared/types'
import type { ScanSession } from '@shared/scanSessions'
import { ArtWashContext, type WashState } from '@/components/artWashContext'
import { BindersPage } from '@/features/binders/BindersPage'
import { BinderView } from '@/features/binders/BinderView'
import { PokedexPage } from '@/features/pokedex/PokedexPage'
import { SessionsPage } from '@/features/sessions/SessionsPage'
import { WishlistPage } from '@/features/wishlist/WishlistPage'
import { GameProvider } from '@/lib/game'
import { gameFallback, sampleCard } from '@/lib/wash/sample'
import { createMockApi, renderWithProviders } from './mockApi'

vi.mock('@/lib/wash/sample', async (orig) => ({
  ...(await orig<typeof import('@/lib/wash/sample')>()),
  sampleCard: vi.fn()
}))

const families = gameFallback('ygo')
const sampled = vi.mocked(sampleCard)
const set = vi.fn<(w: WashState | null) => void>()

beforeEach(() => {
  set.mockClear()
  sampled.mockReset()
  sampled.mockResolvedValue(families)
})
afterEach(() => {
  window.api = undefined as never
})

const wrap = (ui: React.ReactElement): React.ReactElement => (
  <ArtWashContext.Provider value={set}>
    <GameProvider>{ui}</GameProvider>
  </ArtWashContext.Provider>
)
const sampledIds = (): number[] => sampled.mock.calls.map(([c]) => c.imageId)

const summary: BinderSummary = {
  uid: 'b1',
  name: 'Blue-Eyes',
  goal: 'art',
  languages: ['en'],
  friendsVisible: true,
  hasRules: true,
  editable: true,
  ownedSlots: 1,
  missingSlots: 0,
  tooBroad: false,
  coverImageId: 11
}
const slot = (n: number, imageId = n): BinderCard => ({
  key: `art:${n}`,
  level: 'art',
  card: { id: n, name: `Card ${n}`, type: 'Normal Monster', frameType: 'normal' } as CardRow,
  imageId,
  printing: null,
  printingScan: false,
  owned: 1,
  added: false,
  price: null
})

describe('pages hand their cards to the wash', () => {
  it('Binders: the covers of the listed binders', async () => {
    renderWithProviders(wrap(<BindersPage />), {
      api: createMockApi({
        binders: { list: vi.fn(async () => [summary, { ...summary, uid: 'b2', coverImageId: 0 }]) }
      })
    })
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1))
    expect(sampledIds()).toEqual([11])
    expect(set.mock.calls[0][0]).toMatchObject({ families, seed: 11, strength: 1 })
  })

  it('a binder: its own cards, skipping slots with no art', async () => {
    const detail: BinderDetail = {
      ...summary,
      rules: { version: 1, rules: [] },
      cards: [slot(1), slot(2, 0)],
      valueToFinish: 0,
      unpricedMissing: 0
    }
    renderWithProviders(wrap(<BinderView detail={detail} readOnly />))
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1))
    expect(sampledIds()).toEqual([1])
    expect(sampled.mock.calls[0][0]).toEqual({ imageId: 1, frameType: 'normal' })
  })

  it('Wishlist: its cards, at half strength', async () => {
    const card = { id: 1, name: 'Dark Magician', type: 'Normal Monster', frameType: 'normal' }
    const item = {
      pkey: 'en|1|LOB-001|Ultra Rare',
      card,
      printing: {
        id: 1,
        cardId: 1,
        setName: 'Legend of Blue Eyes',
        setCode: 'LOB-001',
        setRarity: 'Ultra Rare',
        setRarityCode: '(UR)',
        language: 'en',
        setPrice: 5,
        missingFromApi: false
      } as Printing,
      imageId: 100,
      printingScan: true,
      quantity: null,
      owned: 0,
      unitPrice: 10,
      priceApproximate: false,
      addedAt: '2026-10-01T00:00:00.000Z'
    } as WishlistItem
    renderWithProviders(wrap(<WishlistPage />), {
      api: createMockApi({
        wishlist: { list: async () => [item] },
        account: { status: async () => ({ user: { id: 1 } }) as never }
      })
    })
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1))
    expect(sampledIds()).toEqual([100])
    expect(set.mock.calls[0][0]).toMatchObject({ seed: 100, strength: 0.5 })
  })

  it('Sessions: the session cards, at half strength', async () => {
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
    renderWithProviders(wrap(<SessionsPage />), {
      api: createMockApi({ sessions: { list: vi.fn(async () => [session]) } })
    })
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1))
    expect(sampledIds()).toEqual([700])
    expect(set.mock.calls[0][0]).toMatchObject({ seed: 700, strength: 0.5 })
  })

  it('Pokédex: only sprites, so it leaves the wash alone', async () => {
    renderWithProviders(wrap(<PokedexPage />), {
      api: createMockApi({ pokedex: { summary: vi.fn(async () => ({ caught: [] })) } })
    })
    await screen.findByText('0 / 1025 caught · 0%')
    expect(sampled).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
  })
})
