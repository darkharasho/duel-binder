import { fireEvent, render, screen } from '@testing-library/react'
import { PKM_ID_MIN, type GameId } from '@shared/games'
import { CardArt } from '@/components/CardArt'
import { CardSheet } from '@/components/CardSheet'
import { PanelCardArt } from '@/components/PanelCardArt'
import { GameProvider } from '@/lib/game'
import { createMockApi, renderWithProviders } from './mockApi'

describe('CardArt', () => {
  it('without a printing it is the plain default art', () => {
    render(<CardArt imageId={5} size="small" alt="Kuriboh" />)
    expect(screen.getByAltText('Kuriboh')).toHaveAttribute('src', 'ygo-img://small/5')
    expect(screen.queryByTestId('printing-scan')).not.toBeInTheDocument()
  })

  it('fades the printing scan in over the default art once it loads', () => {
    render(<CardArt imageId={5} printingId={9} size="small" alt="Kuriboh" />)
    const scan = screen.getByTestId('printing-scan')
    expect(scan).toHaveAttribute('src', 'ygo-img://printing/9')
    expect(scan).toHaveClass('opacity-0')
    fireEvent.load(scan)
    expect(scan).toHaveClass('opacity-100')
    expect(screen.getByAltText('Kuriboh')).toHaveClass('opacity-0')
  })

  it('keeps the default art when the printing has no scan', () => {
    render(<CardArt imageId={5} printingId={9} size="small" alt="Kuriboh" />)
    fireEvent.error(screen.getByTestId('printing-scan'))
    expect(screen.queryByTestId('printing-scan')).not.toBeInTheDocument()
    expect(screen.getByAltText('Kuriboh')).not.toHaveClass('opacity-0')
  })

  it('on the phone it shows the default art and no printing scan', () => {
    const saved = window.api
    window.api = createMockApi({ window: { platform: 'phone' } })
    try {
      render(<CardArt imageId={5} printingId={9} size="small" alt="Kuriboh" />)
      expect(screen.getByAltText('Kuriboh')).toHaveAttribute('src', '/img/small/5')
      expect(screen.queryByTestId('printing-scan')).not.toBeInTheDocument()
    } finally {
      window.api = saved
    }
  })
})

describe('CardArt aspect', () => {
  const PKM_CARD = PKM_ID_MIN + 7

  /** Renders under a game provider showing `game`, once the provider has read it. */
  async function renderInGame(game: GameId, ui: React.ReactElement): Promise<void> {
    renderWithProviders(<GameProvider fallback={null}>{ui}</GameProvider>, {
      api: createMockApi({
        games: { available: async () => ['ygo', 'pkm'], active: async () => game }
      })
    })
    await screen.findAllByRole('img')
  }

  it("keeps Yu-Gi-Oh!'s 421×614 frame", () => {
    render(<CardArt imageId={5} size="small" alt="Kuriboh" />)
    expect(screen.getByAltText('Kuriboh').style.aspectRatio).toBe('421 / 614')
  })

  it("frames a Pokémon card at TCGdex's 600×825 from its id, whatever the game shown", () => {
    render(<CardArt imageId={PKM_CARD} size="small" alt="Pikachu" />)
    expect(screen.getByAltText('Pikachu').style.aspectRatio).toBe('600 / 825')
  })

  it('frames a Yu-Gi-Oh! card at 421×614 while Pokémon shows (a friend’s binder)', async () => {
    await renderInGame('pkm', <CardArt imageId={5} printingId={9} size="small" alt="Kuriboh" />)
    expect(screen.getByAltText('Kuriboh').parentElement!.style.aspectRatio).toBe('421 / 614')
  })

  it('without a card id it takes the game shown', async () => {
    await renderInGame('pkm', <CardArt imageId={0} size="small" alt="Unknown" />)
    expect(screen.getByAltText('Unknown').style.aspectRatio).toBe('600 / 825')
  })

  it("draws the placeholder card back at the card's game's aspect", () => {
    const { unmount } = render(<CardArt imageId={5} size="small" alt="Kuriboh" />)
    fireEvent.error(screen.getByAltText('Kuriboh'))
    const ygo = screen.getByTestId('card-art-placeholder')
    expect(ygo).toHaveAttribute('viewBox', '0 0 421 614')
    expect(ygo.style.aspectRatio).toBe('421 / 614')
    unmount()

    render(<CardArt imageId={PKM_CARD} size="small" alt="Pikachu" />)
    fireEvent.error(screen.getByAltText('Pikachu'))
    const pkm = screen.getByTestId('card-art-placeholder')
    expect(pkm).toHaveAttribute('viewBox', '0 0 600 825')
    expect(pkm.style.aspectRatio).toBe('600 / 825')
  })

  it("caps the panel's large card by the window height at the card's aspect", () => {
    for (const [imageId, ratio] of [
      [5, 'calc(421 / 614)'],
      [PKM_CARD, 'calc(600 / 825)']
    ] as const) {
      const { unmount } = renderWithProviders(
        <CardSheet onClose={() => {}}>
          <PanelCardArt imageId={imageId} alt="Card" />
        </CardSheet>
      )
      const large = document.querySelector<HTMLElement>('[class*="var(--card-aspect)"]')!
      expect(large.parentElement!.style.getPropertyValue('--card-aspect')).toBe(ratio)
      unmount()
    }
  })
})
