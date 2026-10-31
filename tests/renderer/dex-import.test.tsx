import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CollectionPage } from '@/features/collection/CollectionPage'
import { GameProvider } from '@/lib/game'
import type { GameId } from '@shared/games'
import { DexImportButton } from '../../src/renderer/src/features/collection/DexImportDialog'
import { notImportedText } from '../../src/renderer/src/features/collection/dexImportText'
import type { DexPreview } from '../../src/shared/dex/match'
import { createMockApi, renderWithProviders } from './mockApi'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

const HEADER =
  'Type;Category;Locale;Series;Set;Id;Number;Name;Variant;Rarity;Illustrator;Quantity;Price;Note 1;Note 2;Note 3;Note 4;Note 5'
const missing = {
  name: 'Mew',
  set: '30th Celebration',
  number: '161/128',
  variant: 'Holo',
  locale: 'International',
  quantity: 1,
  reason: 'number'
} as const
const PREVIEW: DexPreview = {
  copies: 5,
  printings: 2,
  alreadyOwned: 1,
  zeroRows: 7,
  repeatRows: 3,
  notImported: [missing]
}

const csvFile = (name: string, text: string): File => {
  const bytes = Buffer.from(`\uFEFF${text}`, 'utf16le')
  const file = new File([bytes], name)
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)
  })
  return file
}

async function open(file: File): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Import from Dex' }))
  fireEvent.change(await screen.findByLabelText('Dex CSV files'), { target: { files: [file] } })
}

describe('DexImportButton', () => {
  it('previews a file, then imports it', async () => {
    const api = createMockApi({
      dex: { preview: vi.fn(async () => PREVIEW), apply: vi.fn(async () => ({ copies: 5 })) }
    })
    renderWithProviders(<DexImportButton />, { api })
    await open(
      csvFile(
        'a.csv',
        `${HEADER}\r\ncollection;L;International;S;Set;a-1;1/2;Mew;Normal;R;I;2;—;;;;;\r\n`
      )
    )

    expect(await screen.findByText('5 cards to add, across 2 versions.')).toBeInTheDocument()
    expect(screen.getByText('7 lines skipped: quantity 0.')).toBeInTheDocument()
    expect(screen.getByText(/counts once, at its highest quantity/)).toBeInTheDocument()
    expect(screen.getByText(/importing the same file again adds nothing/)).toBeInTheDocument()
    expect(screen.getByText(/Card number not in this set/)).toBeInTheDocument()
    expect(api.dex.apply).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(api.dex.apply).toHaveBeenCalledTimes(1))
    expect(vi.mocked(api.dex.apply).mock.calls[0][0][0]).toMatchObject({ id: 'a-1', quantity: 2 })
  })

  it('names a file that is not a Dex export and offers no import', async () => {
    renderWithProviders(<DexImportButton />)
    await open(csvFile('b.csv', 'name,qty\n'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "b.csv: This isn't a Dex CSV export."
    )
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
  })

  it('writes the not-imported list as tab-separated lines', () => {
    expect(notImportedText([missing]).split('\n')[1]).toBe(
      'Mew\t30th Celebration\t161/128\tHolo\tInternational\t1\tCard number not in this set'
    )
  })
})

describe('the Collection page', () => {
  const page = (game: GameId): ReturnType<typeof renderWithProviders> =>
    renderWithProviders(
      <GameProvider>
        <CollectionPage />
      </GameProvider>,
      {
        api: createMockApi({
          games: {
            available: vi.fn(async () => ['ygo', 'pkm'] as GameId[]),
            active: vi.fn(async () => game)
          }
        })
      }
    )

  it('offers Dex import for Pokémon', async () => {
    page('pkm')
    expect(await screen.findByRole('button', { name: 'Import from Dex' })).toBeInTheDocument()
  })

  it('does not offer it for Yu-Gi-Oh!', async () => {
    const { api } = page('ygo')
    await waitFor(() => expect(api.games.active).toHaveBeenCalled())
    await screen.findByRole('heading', { name: 'Collection' })
    expect(screen.queryByRole('button', { name: 'Import from Dex' })).not.toBeInTheDocument()
  })
})
