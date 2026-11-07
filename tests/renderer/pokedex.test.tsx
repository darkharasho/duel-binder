import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PokedexCard, PokedexSpecies, PokedexSummary } from '@shared/types'
import { PokedexPage } from '@/features/pokedex/PokedexPage'
import { dexTiles, percentText, progress, visibleTiles } from '@/features/pokedex/pokedexView'
import { invalidateAfterEdit, mutationInvalidationKeys } from '@/lib/api'
import { createMockApi, renderWithProviders } from './mockApi'

const card = (n: number, name: string, copies: number): PokedexCard => ({
  cardId: n,
  imageId: n,
  name,
  setName: `Set ${n}`,
  language: 'en',
  copies
})

const charizard: PokedexSpecies = {
  dexNo: 6,
  owned: [card(1, 'Charizard ex', 3), card(2, 'Dark Charizard', 1)],
  missing: Array.from({ length: 15 }, (_, i) => card(100 + i, `Charizard V${i + 1}`, 0))
}

const summary: PokedexSummary = {
  caught: [
    { dexNo: 6, copies: 4 },
    { dexNo: 25, copies: 1 }
  ]
}

function dexApi(over: { summary?: () => Promise<PokedexSummary> } = {}) {
  return createMockApi({
    pokedex: {
      summary: vi.fn(over.summary ?? (async () => summary)),
      species: vi.fn(async (n: number) =>
        n === 6 ? charizard : { dexNo: n, owned: [], missing: [] }
      )
    }
  })
}

/** The tile of the species with this exact name. */
const tile = (name: string): HTMLElement => {
  const button = screen.getByText(name, { selector: '[data-dex-name]' }).closest('button')
  if (!button) throw new Error(`no tile for ${name}`)
  return button
}

afterEach(() => {
  window.api = undefined as never
})

describe('pokedexView', () => {
  it('gives every species a tile, in dex order, with its copies', () => {
    const tiles = dexTiles(summary)
    expect(tiles).toHaveLength(1025)
    expect(tiles[0]).toEqual({ dexNo: 1, name: 'Bulbasaur', copies: 0 })
    expect(tiles[5]).toEqual({ dexNo: 6, name: 'Charizard', copies: 4 })
    expect(tiles[1024].dexNo).toBe(1025)
  })

  it('filters by caught and generation', () => {
    const tiles = dexTiles({ caught: [...summary.caught, { dexNo: 152, copies: 1 }] })
    expect(visibleTiles(tiles, 'caught', 1).map((t) => t.dexNo)).toEqual([6, 25])
    expect(visibleTiles(tiles, 'caught', null).map((t) => t.dexNo)).toEqual([6, 25, 152])
    expect(visibleTiles(tiles, 'missing', 1)).toHaveLength(149)
    expect(visibleTiles(tiles, 'all', 2)).toHaveLength(100)
  })

  it('counts progress overall and per generation', () => {
    const tiles = dexTiles({ caught: [...summary.caught, { dexNo: 152, copies: 1 }] })
    expect(progress(tiles)).toEqual({ caught: 3, total: 1025 })
    expect(progress(tiles, 1)).toEqual({ caught: 2, total: 151 })
    expect(progress(tiles, 2)).toEqual({ caught: 1, total: 100 })
  })

  it('shows one decimal under 10%, whole numbers from 10%, and 100% only when complete', () => {
    expect(percentText({ caught: 0, total: 1025 })).toBe('0')
    expect(percentText({ caught: 2, total: 1025 })).toBe('0.2')
    expect(percentText({ caught: 51, total: 1025 })).toBe('5.0')
    expect(percentText({ caught: 101, total: 1025 })).toBe('9.9')
    // 9.96%: rounds up into the whole numbers.
    expect(percentText({ caught: 1021, total: 10250 })).toBe('10')
    expect(percentText({ caught: 500, total: 1025 })).toBe('49')
    expect(percentText({ caught: 1024, total: 1025 })).toBe('99')
    expect(percentText({ caught: 1025, total: 1025 })).toBe('100')
  })
})

describe('the Pokédex page', () => {
  it('shows progress, the generations and a copies badge', async () => {
    renderWithProviders(<PokedexPage />, { api: dexApi() })
    expect(await screen.findByText('2 / 1025 caught · 0.2%')).toBeInTheDocument()
    expect(screen.getByText('Generation I · Kanto')).toBeInTheDocument()
    expect(screen.getByText('Generation IX · Paldea')).toBeInTheDocument()
    expect(within(tile('Charizard')).getByText('×4')).toBeInTheDocument()
    expect(within(tile('Charizard')).getByText('#006')).toBeInTheDocument()
    // One copy: no badge.
    expect(within(tile('Pikachu')).queryByText(/×/)).not.toBeInTheDocument()
    expect(
      screen.getByText('Sprites: PokeAPI and the sprite artists credited there.')
    ).toBeInTheDocument()
  })

  it('draws caught sprites in colour and missing ones as silhouettes, pixelated and lazy', async () => {
    renderWithProviders(<PokedexPage />, { api: dexApi() })
    await screen.findByText(/2 \/ 1025 caught/)
    const caught = tile('Charizard').querySelector('img')!
    const missing = tile('Bulbasaur').querySelector('img')!
    expect(caught).toHaveAttribute('loading', 'lazy')
    expect(caught.style.imageRendering).toBe('pixelated')
    expect(caught.className).not.toMatch(/brightness-0/)
    expect(missing.className).toMatch(/brightness-0/)
    expect(tile('Bulbasaur')).toHaveAttribute('data-caught', 'false')
    expect(tile('Charizard')).toHaveAttribute('data-caught', 'true')
  })

  it('hides a sprite that fails to load, keeping the name and number', async () => {
    renderWithProviders(<PokedexPage />, { api: dexApi() })
    await screen.findByText(/2 \/ 1025 caught/)
    const img = tile('Bulbasaur').querySelector('img')!
    fireEvent.error(img)
    expect(img.style.visibility).toBe('hidden')
    expect(within(tile('Bulbasaur')).getByText('#001')).toBeInTheDocument()
  })

  it('the Missing filter hides caught tiles', async () => {
    renderWithProviders(<PokedexPage />, { api: dexApi() })
    await screen.findByText(/2 \/ 1025 caught/)
    await userEvent.click(screen.getByRole('button', { name: 'Missing', pressed: false }))
    expect(screen.queryByText('Charizard', { selector: '[data-dex-name]' })).toBeNull()
    expect(tile('Bulbasaur')).toBeInTheDocument()
  })

  it('a generation chip shows only that generation', async () => {
    renderWithProviders(<PokedexPage />, { api: dexApi() })
    await screen.findByText(/2 \/ 1025 caught/)
    await userEvent.click(screen.getByRole('button', { name: 'II', pressed: false }))
    expect(screen.queryByText('Generation I · Kanto')).toBeNull()
    expect(screen.getByText('Generation II · Johto')).toBeInTheDocument()
    expect(tile('Chikorita')).toBeInTheDocument()
    expect(screen.queryByText('Charizard', { selector: '[data-dex-name]' })).toBeNull()
  })

  it("opens a species' panel with Yours and Missing; Show all reveals the rest", async () => {
    const api = dexApi()
    renderWithProviders(<PokedexPage />, { api })
    await screen.findByText(/2 \/ 1025 caught/)
    await userEvent.click(tile('Charizard'))
    const panel = await screen.findByRole('dialog')
    expect(await within(panel).findByText('you have 2 cards · 15 missing')).toBeInTheDocument()
    expect(within(panel).getByText('#006')).toBeInTheDocument()
    const yours = within(panel).getByRole('region', { name: 'Yours' })
    expect(within(yours).getByText('Charizard ex')).toBeInTheDocument()
    expect(within(yours).getByText('Dark Charizard')).toBeInTheDocument()
    expect(within(yours).getByText('×3')).toBeInTheDocument()
    const missing = within(panel).getByRole('region', { name: 'Missing' })
    expect(within(missing).getAllByRole('button', { name: /Charizard V/ })).toHaveLength(12)
    await userEvent.click(within(missing).getByRole('button', { name: 'Show all 15' }))
    expect(within(missing).getAllByRole('button', { name: /Charizard V/ })).toHaveLength(15)
    expect(api.pokedex.species).toHaveBeenCalledWith(6)
  })

  it('a card in the panel opens its card panel', async () => {
    const api = dexApi()
    renderWithProviders(<PokedexPage />, { api })
    await screen.findByText(/2 \/ 1025 caught/)
    await userEvent.click(tile('Charizard'))
    const panel = await screen.findByRole('dialog')
    await userEvent.click(await within(panel).findByRole('button', { name: /Dark Charizard/ }))
    await waitFor(() => expect(api.cards.get).toHaveBeenCalledWith(2))
  })

  it('a card with no image shows the placeholder and asks for no image', async () => {
    const api = createMockApi({
      pokedex: {
        summary: vi.fn(async () => summary),
        species: vi.fn(async (n: number) => ({
          dexNo: n,
          owned: [{ ...card(7, 'Charizard Promo', 1), imageId: 0 }],
          missing: []
        }))
      }
    })
    renderWithProviders(<PokedexPage />, { api })
    await screen.findByText(/2 \/ 1025 caught/)
    await userEvent.click(tile('Charizard'))
    const panel = await screen.findByRole('dialog')
    const yours = await within(panel).findByRole('region', { name: 'Yours' })
    expect(within(yours).getByTestId('card-art-placeholder')).toBeInTheDocument()
    // The only image in the card tile is none at all; the panel's one img is the sprite.
    const imgs = [...panel.querySelectorAll('img')].map((i) => i.getAttribute('src') ?? '')
    expect(imgs.every((src) => src.includes('sprite/'))).toBe(true)
    expect(imgs.some((src) => /(^|\/)0($|[/?.])/.test(src))).toBe(false)
  })

  it('a species with no cards says so', async () => {
    renderWithProviders(<PokedexPage />, { api: dexApi() })
    await screen.findByText(/2 \/ 1025 caught/)
    await userEvent.click(tile('Pecharunt'))
    const panel = await screen.findByRole('dialog')
    expect(await within(panel).findByText('No cards of Pecharunt yet')).toBeInTheDocument()
    expect(within(panel).getByText('#1025')).toBeInTheDocument()
  })

  it('a removed last copy turns the tile missing without a restart', async () => {
    let current = summary
    const { client } = renderWithProviders(<PokedexPage />, {
      api: dexApi({ summary: async () => current })
    })
    await screen.findByText(/2 \/ 1025 caught/)
    expect(tile('Pikachu')).toHaveAttribute('data-caught', 'true')
    expect(mutationInvalidationKeys).toContainEqual(['pokedex'])
    // What a collection:remove (EntryEditor) runs once it lands.
    current = { caught: [{ dexNo: 6, copies: 4 }] }
    await act(() => invalidateAfterEdit(client))
    expect(await screen.findByText(/1 \/ 1025 caught/)).toBeInTheDocument()
    expect(tile('Pikachu')).toHaveAttribute('data-caught', 'false')
  })
})
