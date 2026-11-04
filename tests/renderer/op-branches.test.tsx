import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ONEPIECE_ID_MIN, printingNoun, type GameId } from '@shared/games'
import { OP_RARITIES } from '@shared/games/onePiece'
import { rarityColor, rarityColors } from '@/lib/rarityColors'
import { CardPlaceholder } from '@/components/CardPlaceholder'
import { CardArt } from '@/components/CardArt'
import { HIDDEN_SORTS } from '@/lib/filters'
import { checklistSorts } from '@/features/sets/setsView'
import { ownedText } from '@/features/scan/owned'
import { loadStream, saveStream, type StreamRecord } from '../../src/phone/stream/record'
import { resetPrintingPhotos } from '@/lib/printingPhotos'

const GREY = '#9ca3af'

describe('rarityColor by game', () => {
  it("One Piece's distinctive rarities have their own colours", () => {
    const special = ['L', 'SEC', 'SP', 'TR'].map((r) => rarityColor(r, 'op'))
    expect(special).not.toContain(GREY)
    expect(new Set(special).size).toBe(4)
    for (const r of OP_RARITIES) expect(rarityColors('op')[r]).toBeDefined()
    expect(rarityColor('Nonsense', 'op')).toBe(GREY)
  })

  it('Yu-Gi-Oh and Pokémon colours are unchanged', () => {
    expect(rarityColor('Ultra Rare', 'ygo')).toBe('#e9c46a')
    expect(rarityColor('Ultra Rare')).toBe('#e9c46a')
    expect(rarityColor('SEC', 'ygo')).toBe(GREY)
    expect(rarityColor('Holofoil', 'pkm')).toBe('#d4a93c')
    expect(rarityColor('Shadowless Holofoil', 'pkm')).toBe('#d4a93c')
    expect(rarityColor('Reverse Holofoil', 'pkm')).toBe('#8fb4cf')
    expect(rarityColor('Ultra Rare', 'pkm')).toBe(GREY)
  })
})

describe('CardPlaceholder by game', () => {
  const aspect = { width: 600, height: 838 }
  it("'op' draws its own plain placeholder, not the Yu-Gi-Oh! frame", () => {
    render(<CardPlaceholder game="op" label="Luffy" aspect={aspect} />)
    const svg = screen.getByTestId('card-art-placeholder')
    expect(svg).toHaveAttribute('data-game', 'op')
    expect(svg).toHaveAttribute('viewBox', '0 0 600 838')
    expect(svg.querySelector('ellipse')).toBeNull()
  })

  it.each([
    ['ygo', 'ygo'],
    ['pkm', 'pkm']
  ] as [GameId, string][])('%s keeps its own placeholder', (game, tag) => {
    render(<CardPlaceholder game={game} label="x" aspect={{ width: 421, height: 614 }} />)
    expect(screen.getByTestId('card-art-placeholder')).toHaveAttribute('data-game', tag)
  })
})

describe('sort lists by game', () => {
  it('hides each game’s missing columns', () => {
    expect(HIDDEN_SORTS.ygo).toEqual(['hp', 'cost', 'power'])
    expect(HIDDEN_SORTS.pkm).toEqual(['atk', 'def', 'level', 'cost', 'power'])
    expect(HIDDEN_SORTS.op).toEqual(['atk', 'def', 'level', 'hp'])
    const values = (g: GameId): string[] => checklistSorts(g).map((s) => s.value)
    expect(values('ygo')).toContain('atk')
    expect(values('ygo')).not.toContain('hp')
    expect(values('pkm')).toContain('hp')
    expect(values('pkm')).not.toContain('atk')
    expect(values('op')).not.toContain('atk')
    expect(values('op')).not.toContain('hp')
    expect(values('op')).toContain('name')
  })
})

describe('printing vocabulary', () => {
  it("'op' says version like Pokémon; Yu-Gi-Oh! says printing", () => {
    expect(printingNoun('ygo')).toBe('printing')
    expect(printingNoun('pkm')).toBe('version')
    expect(printingNoun('op')).toBe('version')
    const o = { copies: 0, others: 1 }
    expect(ownedText(o, 1, 'ygo')).toBe('New printing · Own 1 other')
    expect(ownedText(o, 1, 'pkm')).toBe('New version · Own 1 other')
    expect(ownedText(o, 1, 'op')).toBe('New version · Own 1 other')
  })
})

describe('stream record', () => {
  beforeEach(() => localStorage.clear())
  it("keeps a record with game 'op' and drops an unknown game", () => {
    for (const game of ['ygo', 'pkm', 'op'] as const) {
      saveStream({ game, rows: [], saved: {} } as StreamRecord)
      expect(loadStream()?.game).toBe(game)
    }
    saveStream({ game: 'zz', rows: [], saved: {} } as unknown as StreamRecord)
    expect(loadStream()).toBeNull()
  })
})

describe('CardArt printing photos', () => {
  beforeEach(() => resetPrintingPhotos())
  it("requests no printing photo for an 'op' image id, only for Yu-Gi-Oh!", () => {
    const { unmount } = render(
      <CardArt imageId={ONEPIECE_ID_MIN + 7} printingId={9} size="small" alt="Luffy" />
    )
    expect(screen.queryByTestId('printing-scan')).not.toBeInTheDocument()
    unmount()
    render(<CardArt imageId={5} printingId={9} size="small" alt="Kuriboh" />)
    expect(screen.getByTestId('printing-scan')).toBeInTheDocument()
  })
})
