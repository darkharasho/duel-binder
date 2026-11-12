import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { ScanRowItem, type ScanRowActions } from '@/features/scan/ScanRowItem'
import { ScanHubProvider, useScanHub } from '@/features/scan/ScanHub'
import { ScanFinishPicker } from '@/features/scan/FinishPicker'
import type { ScanRow } from '@/features/scan/session'
import { GameProvider } from '@/lib/game'
import type { GameId } from '@shared/games'
import { createMockApi, renderWithProviders } from './mockApi'
import { printing } from './scanFakes'
import { artCandidates } from '@/features/scan/useScanLoop'

const strike = (o: Parameters<typeof printing>[0]) =>
  printing({
    cardId: 7,
    name: 'Lightning Strike',
    frameType: 'mtg',
    setName: 'Reality Fracture',
    setCode: 'FRA 107',
    imageIds: [9001],
    ...o
  })
const PLAIN = strike({ printingId: 501, rarity: 'Uncommon', price: 0.25 })
const FOIL = strike({ printingId: 502, rarity: 'Uncommon (Foil)', price: 1.5 })

const row = (o: Partial<ScanRow> = {}): ScanRow => ({
  key: 'k',
  quantity: 1,
  addedAt: 0,
  game: 'mtg',
  cardId: 7,
  name: 'Lightning Strike',
  imageId: 9001,
  printingId: 501,
  setCode: 'FRA 107',
  rarity: 'Uncommon',
  options: [PLAIN, FOIL],
  flag: null,
  via: 'art',
  ...o
})

describe('the Magic foil toggle', () => {
  it('switches a Magic row to its foil printing and back', () => {
    const setPrinting = vi.fn()
    const actions: ScanRowActions = { setPrinting, setQuantity: () => {}, remove: () => {} }
    const { rerender } = renderWithProviders(
      <ScanRowItem row={row()} actions={actions} language={null} scanned={1} />
    )
    const toggle = screen.getByRole('button', { name: 'Foil' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByLabelText('Price of Lightning Strike')).toHaveTextContent('$0.25')
    fireEvent.click(toggle)
    expect(setPrinting).toHaveBeenLastCalledWith('k', 502)

    rerender(
      <ScanRowItem
        row={row({ printingId: 502, rarity: 'Uncommon (Foil)' })}
        actions={actions}
        language={null}
        scanned={1}
      />
    )
    expect(screen.getByRole('button', { name: 'Foil' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Price of Lightning Strike')).toHaveTextContent('$1.50')
    fireEvent.click(screen.getByRole('button', { name: 'Foil' }))
    expect(setPrinting).toHaveBeenLastCalledWith('k', 501)
  })

  it('hides the toggle when the printing has one finish', () => {
    const actions: ScanRowActions = {
      setPrinting: () => {},
      setQuantity: () => {},
      remove: () => {}
    }
    renderWithProviders(
      <ScanRowItem row={row({ options: [PLAIN] })} actions={actions} language={null} scanned={1} />
    )
    expect(screen.queryByRole('button', { name: 'Foil' })).toBeNull()
  })
})

describe('the session finish lock', () => {
  function Lock(): React.JSX.Element {
    const { settings } = useScanHub()
    return <p data-testid="lock">{settings.finishLock ?? 'auto'}</p>
  }
  const renderPicker = (game: GameId) => {
    const api = createMockApi()
    api.games.available = vi.fn(async () => ['ygo', game] as never)
    api.games.active = vi.fn(async () => game)
    return renderWithProviders(
      <GameProvider>
        <ScanHubProvider>
          <ScanFinishPicker />
          <Lock />
        </ScanHubProvider>
      </GameProvider>,
      { api }
    )
  }

  it('hides finish controls for other games', async () => {
    renderPicker('pkm')
    await waitFor(() => expect(screen.getByTestId('lock')).toBeInTheDocument())
    await act(async () => {})
    expect(screen.queryByText('Finish')).toBeNull()
    const actions: ScanRowActions = {
      setPrinting: () => {},
      setQuantity: () => {},
      remove: () => {}
    }
    renderWithProviders(
      <ScanRowItem
        row={row({ game: undefined, options: [PLAIN, FOIL] })}
        actions={actions}
        language={null}
        scanned={1}
      />
    )
    expect(screen.queryByRole('button', { name: 'Foil' })).toBeNull()
  })

  function Session(): React.JSX.Element {
    const { count, session } = useScanHub()
    return (
      <>
        <button onClick={() => count({ ...row(), options: [PLAIN, FOIL] })}>count</button>
        <button onClick={() => session.clear()}>clear</button>
      </>
    )
  }
  const renderSession = (api = createMockApi()) => {
    api.games.available = vi.fn(async () => ['ygo', 'pkm', 'mtg'] as never)
    api.games.active = vi.fn(async () => 'mtg' as never)
    renderWithProviders(
      <GameProvider>
        <ScanHubProvider>
          <ScanFinishPicker />
          <Lock />
          <Session />
        </ScanHubProvider>
      </GameProvider>,
      { api }
    )
    return api
  }
  const lockFoil = async (): Promise<void> => {
    fireEvent.click(await screen.findByRole('combobox', { name: 'Finish' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Foil' }))
    expect(screen.getByTestId('lock')).toHaveTextContent('foil')
  }

  it('goes back to Auto when the list is emptied', async () => {
    renderSession()
    await lockFoil()
    fireEvent.click(screen.getByText('count'))
    expect(screen.getByTestId('lock')).toHaveTextContent('foil')
    fireEvent.click(screen.getByText('clear'))
    await waitFor(() => expect(screen.getByTestId('lock')).toHaveTextContent('auto'))
  })

  it('goes back to Auto when the game changes', async () => {
    const api = renderSession()
    await lockFoil()
    const changed = vi.mocked(api.app.onDataChanged).mock.calls.map((c) => c[0] as () => void)
    api.games.active = vi.fn(async () => 'pkm' as never)
    await act(async () => changed.forEach((f) => f()))
    await waitFor(() => expect(screen.getByTestId('lock')).toHaveTextContent('auto'))
  })

  it('starts every session at Auto', async () => {
    const first = renderPicker('mtg')
    await screen.findByText('Finish')
    expect(screen.getByTestId('lock')).toHaveTextContent('auto')
    fireEvent.click(screen.getByRole('combobox', { name: 'Finish' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Foil' }))
    expect(screen.getByTestId('lock')).toHaveTextContent('foil')
    expect(JSON.stringify({ ...localStorage })).not.toMatch(/foil/i)
    first.unmount()
    renderPicker('mtg')
    await screen.findByText('Finish')
    expect(screen.getByTestId('lock')).toHaveTextContent('auto')
  })
})

describe('artCandidates', () => {
  it("searches all Magic art with a set picked, since a set's records are other printings' looks", () => {
    expect(artCandidates([PLAIN, FOIL], 'mtg')).toBeNull()
  })

  it("narrows other games to the picked set's art", () => {
    expect(artCandidates([PLAIN, FOIL], 'ygo')).toEqual([9001])
    expect(artCandidates(null, 'ygo')).toBeNull()
    expect(artCandidates([{ ...PLAIN, language: 'zh-hans' }], 'pkm')).toBeNull()
  })
})
