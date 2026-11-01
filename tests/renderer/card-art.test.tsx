import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PKM_ID_MIN, type GameId } from '@shared/games'
import { CardArt } from '@/components/CardArt'
import { CardSheet } from '@/components/CardSheet'
import { PanelCardArt } from '@/components/PanelCardArt'
import { resetBorrowedArt } from '@/lib/borrowedArt'
import { GameProvider } from '@/lib/game'
import { createMockApi, renderWithProviders } from './mockApi'

describe('CardArt', () => {
  it('without a printing it is the plain default art', () => {
    render(<CardArt imageId={5} size="small" alt="Kuriboh" />)
    expect(screen.getByAltText('Kuriboh')).toHaveAttribute('src', 'ygo-img://small/5')
    expect(screen.queryByTestId('printing-scan')).not.toBeInTheDocument()
  })

  it('shimmers in the frame while the art downloads, then fades it in', () => {
    render(<CardArt imageId={5} size="small" alt="Kuriboh" />)
    const img = screen.getByAltText('Kuriboh')
    expect(img).toHaveClass('art-loading')
    fireEvent.load(img)
    expect(img).not.toHaveClass('art-loading')
    expect(img).toHaveClass('art-reveal')
  })

  it('with a printing, the frame shimmers until the default art loads', () => {
    const { container } = render(<CardArt imageId={5} printingId={9} size="small" alt="Kuriboh" />)
    const frame = container.firstElementChild!
    expect(frame).toHaveClass('art-loading')
    fireEvent.load(screen.getByAltText('Kuriboh'))
    expect(frame).not.toHaveClass('art-loading')
    expect(screen.getByAltText('Kuriboh')).toHaveClass('art-reveal')
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

describe('CardArt gaps', () => {
  it('requests no printing scan for a Pokémon card', () => {
    render(<CardArt imageId={PKM_ID_MIN + 7} printingId={9} size="small" alt="Pikachu" />)
    expect(screen.queryByTestId('printing-scan')).not.toBeInTheDocument()
  })

  it('asks for priority only when told to', () => {
    const { rerender } = render(<CardArt imageId={5} size="full" alt="K" />)
    expect(screen.getByAltText('K')).toHaveAttribute('src', 'ygo-img://full/5')
    rerender(<CardArt imageId={5} size="full" alt="K" priority />)
    expect(screen.getByAltText('K')).toHaveAttribute('src', 'ygo-img://full/5?now')
  })

  it("the panel's large card downloads ahead of the queue", () => {
    renderWithProviders(
      <CardSheet onClose={() => {}}>
        <PanelCardArt imageId={5} alt="Card" />
      </CardSheet>
    )
    for (const img of screen.getAllByRole('img')) {
      expect(img).toHaveAttribute('src', 'ygo-img://full/5?now')
    }
  })

  it('a failed card does not leave the next card as a card back', () => {
    const { rerender } = render(<CardArt imageId={5} size="full" alt="A" />)
    fireEvent.error(screen.getByAltText('A'))
    expect(screen.getByTestId('card-art-placeholder')).toBeInTheDocument()
    rerender(<CardArt imageId={6} size="full" alt="B" />)
    expect(screen.queryByTestId('card-art-placeholder')).not.toBeInTheDocument()
    expect(screen.getByAltText('B')).toHaveAttribute('src', 'ygo-img://full/6')
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

  it("picks the placeholder by the card's game", () => {
    const { unmount } = render(<CardArt imageId={5} size="small" alt="Kuriboh" />)
    fireEvent.error(screen.getByAltText('Kuriboh'))
    expect(screen.getByTestId('card-art-placeholder')).toHaveAttribute('data-game', 'ygo')
    unmount()
    render(<CardArt imageId={PKM_CARD} size="small" alt="Pikachu" />)
    fireEvent.error(screen.getByAltText('Pikachu'))
    expect(screen.getByTestId('card-art-placeholder')).toHaveAttribute('data-game', 'pkm')
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

describe('CardArt with borrowed art', () => {
  const own = PKM_ID_MIN + 1
  const twin = PKM_ID_MIN + 2
  const load = (pairs: [number, number][]): ReturnType<typeof vi.fn> => {
    const borrowedArt = vi.fn(async () => pairs)
    const mock = createMockApi()
    window.api = { ...mock, cards: { ...mock.cards, borrowedArt } }
    return borrowedArt
  }
  beforeEach(resetBorrowedArt)
  afterEach(resetBorrowedArt)

  it("shows the twin's image with the label, never asking for its own missing art", async () => {
    load([[own, twin]])
    render(<CardArt imageId={own} size="full" alt="Oddish" className="w-40" />)
    expect(screen.queryByRole('img', { name: 'Oddish' })?.tagName).not.toBe('IMG')
    const img = await screen.findByAltText('Oddish (English art)')
    expect(img).toHaveAttribute('src', `ygo-img://full/${twin}`)
    expect(screen.getByTestId('english-art-label')).toHaveTextContent('English art')
    expect(img.closest('[title="English art"]')).toHaveClass('w-40')
  })

  it('a card with its own art has no label', async () => {
    load([[twin, own]])
    render(<CardArt imageId={own} size="full" alt="Oddish" />)
    expect((await screen.findByAltText('Oddish')).getAttribute('src')).toBe(`ygo-img://full/${own}`)
    expect(screen.queryByTestId('english-art-label')).not.toBeInTheDocument()
  })

  it('a twin whose image fails falls to the placeholder, keeping the label off nothing else', async () => {
    load([[own, twin]])
    render(<CardArt imageId={own} size="small" alt="Oddish" />)
    fireEvent.error(await screen.findByAltText('Oddish (English art)'))
    expect(screen.getByTestId('card-art-placeholder')).toBeInTheDocument()
  })

  it('never asks about a Yu-Gi-Oh! card', () => {
    const asked = load([])
    render(<CardArt imageId={5} size="small" alt="Kuriboh" />)
    expect(screen.getByAltText('Kuriboh')).toHaveAttribute('src', 'ygo-img://small/5')
    expect(asked).not.toHaveBeenCalled()
  })
})
