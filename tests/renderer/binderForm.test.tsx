import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GameId } from '@shared/games'
import type { BinderCard, BinderDetail, CardRow, CardBinder, SetSummary } from '@shared/types'
import { AddToBinder } from '@/features/binders/AddToBinder'
import { BinderForm } from '@/features/binders/BinderForm'
import { BindersPage } from '@/features/binders/BindersPage'
import { GameProvider } from '@/lib/game'
import { createMockApi, renderWithProviders } from './mockApi'

function renderForm(
  over: Parameters<typeof createMockApi>[0] = {},
  props: Partial<React.ComponentProps<typeof BinderForm>> = {},
  game: GameId = 'ygo'
): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <GameProvider>
      <BinderForm onDone={() => {}} onCancel={() => {}} {...props} />
    </GameProvider>,
    {
      api: createMockApi({
        games: { available: async () => [game], active: async () => game },
        ...over
      })
    }
  )
}

const optionTexts = (label: string): string[] =>
  Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((o) => o.text)

afterEach(() => {
  window.api = undefined as never
})

describe('the binder form fields', () => {
  it('offers Yu-Gi-Oh! its fields and goals, without artist', async () => {
    renderForm()
    await screen.findByLabelText('Add rule')
    await waitFor(() => expect(optionTexts('Goal')).toContain('One of each art'))
    expect(optionTexts('Add rule')).toContain('Archetype')
    expect(optionTexts('Add rule')).not.toContain('Artist')
    expect(optionTexts('Add rule')[0]).toBe('Add rule · leave empty for a manual binder')
  })

  it('offers Pokémon an artist, and no art goal', async () => {
    renderForm({}, {}, 'pkm')
    await waitFor(() => expect(optionTexts('Add rule')).toContain('Artist'))
    expect(optionTexts('Goal')).not.toContain('One of each art')
    expect(optionTexts('Goal')).toContain('One of each card')
  })

  it('says that no language means every language, and shows friends on by default', () => {
    renderForm()
    expect(screen.getByText(/none selected means every language/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Friends can see this binder')).toBeChecked()
  })
})

describe('the live preview', () => {
  it('previews a complete rule after typing, not an incomplete one', async () => {
    const preview = vi.fn(async () => ({ printings: 12, cards: 5, owned: 2, tooBroad: false }))
    renderForm({ binders: { preview } })
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Add rule'), 'name')
    expect(preview).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('Name value'), 'Blue')
    expect(await screen.findByText(/12 printings/)).toBeInTheDocument()
    expect(preview).toHaveBeenCalledTimes(1)
    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({
        rules: { version: 1, rules: [{ field: 'name', op: 'contains', value: 'Blue' }] }
      })
    )
  })

  it('shows 0 for an artist rule with no matches', async () => {
    renderForm({ binders: { fieldValues: vi.fn(async () => ['Nobody']) } }, {}, 'pkm')
    const user = userEvent.setup()
    await user.selectOptions(await screen.findByLabelText('Add rule'), 'artist')
    await user.click(screen.getByLabelText('Search Artist'))
    await user.click(await screen.findByRole('button', { name: 'Nobody' }))
    expect(await screen.findByText(/^0 printings/)).toBeInTheDocument()
  })

  it('shows no preview, and no crash, when the preview fails', async () => {
    const preview = vi.fn(async () => {
      throw new Error('bad')
    })
    renderForm({ binders: { preview } })
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Add rule'), 'name')
    await user.type(screen.getByLabelText('Name value'), 'a')
    await waitFor(() => expect(preview).toHaveBeenCalled())
    expect(screen.queryByText(/printings/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Name value')).toBeInTheDocument()
  })

  it('picks a field value, shows set display names and keeps the raw one', async () => {
    const preview = vi.fn(async () => ({ printings: 0, cards: 0, owned: 0, tooBroad: false }))
    renderForm({
      binders: { preview, fieldValues: vi.fn(async () => ['Legend of Blue Eyes White Dragon']) },
      sets: {
        list: vi.fn(async () => [
          {
            setName: 'Legend of Blue Eyes White Dragon',
            setCode: 'LOB',
            language: 'en'
          } as SetSummary
        ])
      }
    })
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Add rule'), 'set')
    await user.click(screen.getByLabelText('Search Set'))
    await user.click(
      await screen.findByRole('button', { name: /Legend of Blue Eyes White Dragon/ })
    )
    await waitFor(() =>
      expect(preview).toHaveBeenCalledWith(
        expect.objectContaining({
          rules: {
            version: 1,
            rules: [{ field: 'set', values: ['Legend of Blue Eyes White Dragon'] }]
          }
        })
      )
    )
  })
})

describe('field value search', () => {
  it('asks once after typing pauses', async () => {
    const fieldValues = vi.fn<(field: string, q: string) => Promise<string[]>>(async () => [
      'Alpha'
    ])
    renderForm({ binders: { fieldValues } })
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Add rule'), 'archetype')
    await user.type(screen.getByLabelText('Search Archetype'), 'blue')
    await waitFor(() => expect(fieldValues).toHaveBeenCalledTimes(2))
    expect(fieldValues.mock.calls.map((c) => c[1])).toEqual(['', 'blue'])
  })
})

describe('saving', () => {
  it('disables Save for a too-broad rule and says why', async () => {
    const preview = vi.fn(async () => ({ printings: 20000, cards: 9000, owned: 0, tooBroad: true }))
    renderForm({ binders: { preview } })
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Name'), 'Everything')
    await user.selectOptions(screen.getByLabelText('Add rule'), 'name')
    await user.type(screen.getByLabelText('Name value'), 'a')
    expect(await screen.findByText(/match too many cards/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('shows the validation message and blocks Save without a name', () => {
    renderForm()
    expect(screen.getByText('A binder needs a name.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('saves the draft', async () => {
    const save = vi.fn(async () => 'new-uid')
    const onDone = vi.fn()
    const { client } = renderForm({ binders: { save } }, { onDone })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Name'), 'Blue-Eyes')
    await user.selectOptions(screen.getByLabelText('Add rule'), 'name')
    await user.type(screen.getByLabelText('Name value'), 'Blue-Eyes')
    await user.selectOptions(screen.getByLabelText('Goal'), 'card')
    await user.click(screen.getByLabelText('Japanese'))
    await user.click(screen.getByLabelText('Friends can see this binder'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('new-uid'))
    expect(save).toHaveBeenCalledWith({
      name: 'Blue-Eyes',
      rules: { version: 1, rules: [{ field: 'name', op: 'contains', value: 'Blue-Eyes' }] },
      goal: 'card',
      languages: ['ja'],
      friendsVisible: false
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['binders'] })
  })

  it('edits a binder in place and deletes it only after confirming', async () => {
    const remove = vi.fn(async () => undefined)
    const onDone = vi.fn()
    renderForm(
      { binders: { remove } },
      {
        binder: {
          uid: 'b1',
          name: 'Mine',
          goal: 'none',
          languages: [],
          friendsVisible: true,
          rules: { version: 1, rules: [] }
        } as unknown as BinderDetail,
        onDone
      }
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(remove).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('b1'))
    expect(onDone).toHaveBeenCalled()
  })
})

describe('add to binder', () => {
  const forCard = (rows: Partial<CardBinder>[]): (() => Promise<CardBinder[]>) =>
    vi.fn(async () =>
      rows.map((r, i) => ({ uid: `b${i}`, name: `Binder ${i}`, inBinder: false, edit: null, ...r }))
    )

  it('adds at card level, then at printing level when a printing is picked', async () => {
    const edit = vi.fn(async () => undefined)
    renderWithProviders(
      <AddToBinder
        cardId={7}
        printing={{ pkey: 'ygo:LOB-EN001:ur', label: 'LOB-EN001 · Ultra Rare' }}
      />,
      {
        api: createMockApi({ binders: { forCard: forCard([{}]), edit } })
      }
    )
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add to Binder 0' }))
    expect(edit).toHaveBeenLastCalledWith('b0', { level: 'card', target: '7' }, 'add')
    await user.click(screen.getByLabelText(/This printing/))
    await user.click(screen.getByRole('button', { name: 'Add to Binder 0' }))
    expect(edit).toHaveBeenLastCalledWith(
      'b0',
      { level: 'printing', target: 'ygo:LOB-EN001:ur' },
      'add'
    )
  })

  it('removes a card a rule holds, and undoes a hand add', async () => {
    const edit = vi.fn(async () => undefined)
    renderWithProviders(<AddToBinder cardId={7} />, {
      api: createMockApi({
        binders: {
          forCard: forCard([{ inBinder: true }, { inBinder: true, edit: 'add' }]),
          edit
        }
      })
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Remove from Binder 0' }))
    expect(edit).toHaveBeenLastCalledWith('b0', { level: 'card', target: '7' }, 'remove')
    await user.click(screen.getByRole('button', { name: 'Remove from Binder 1' }))
    expect(edit).toHaveBeenLastCalledWith('b1', { level: 'card', target: '7' }, null)
  })

  it('only adds at printing level, whatever the card-level state', async () => {
    const edit = vi.fn(async () => undefined)
    renderWithProviders(<AddToBinder cardId={7} printing={{ pkey: 'k:1', label: 'X' }} />, {
      api: createMockApi({
        binders: { forCard: forCard([{ inBinder: true, edit: 'add' }]), edit }
      })
    })
    const user = userEvent.setup()
    await user.click(await screen.findByLabelText(/This printing/))
    expect(screen.queryByRole('button', { name: /Remove from/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add to Binder 0' }))
    expect(edit).toHaveBeenLastCalledWith('b0', { level: 'printing', target: 'k:1' }, 'add')
  })

  it('undoes a hand remove by dropping it', async () => {
    const edit = vi.fn(async () => undefined)
    renderWithProviders(<AddToBinder cardId={7} />, {
      api: createMockApi({ binders: { forCard: forCard([{ edit: 'remove' }]), edit } })
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Add to Binder 0' }))
    expect(edit).toHaveBeenCalledWith('b0', { level: 'card', target: '7' }, null)
  })

  it('refreshes the binder lists after an edit', async () => {
    const { client } = renderWithProviders(<AddToBinder cardId={7} />, {
      api: createMockApi({ binders: { forCard: forCard([{}]) } })
    })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await userEvent.click(await screen.findByRole('button', { name: 'Add to Binder 0' }))
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['binders'] }))
  })
})

describe('removing a slot from a binder', () => {
  it('sends the slot level and target, splitting the key on the first colon', async () => {
    const slot: BinderCard = {
      key: 'printing:ygo:LOB-EN001:ur',
      level: 'printing',
      card: { id: 3, name: 'Card 3', type: 'Normal Monster', frameType: 'normal' } as CardRow,
      imageId: 3,
      printing: null,
      printingScan: false,
      owned: 1,
      added: false,
      price: null
    }
    const edit = vi.fn(async () => undefined)
    const detail = {
      uid: 'b1',
      name: 'B',
      goal: 'none',
      languages: [],
      friendsVisible: true,
      hasRules: true,
      editable: true,
      ownedSlots: 1,
      missingSlots: 0,
      tooBroad: false,
      coverImageId: null,
      rules: { version: 1, rules: [] },
      cards: [slot],
      valueToFinish: 0,
      unpricedMissing: 0
    } as BinderDetail
    renderWithProviders(<BindersPage />, {
      api: createMockApi({
        binders: { list: async () => [detail], get: async () => detail, edit }
      })
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /^B/ }))
    await user.click(await screen.findByRole('button', { name: 'Remove Card 3 from this binder' }))
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith(
        'b1',
        { level: 'printing', target: 'ygo:LOB-EN001:ur' },
        'remove'
      )
    )
  })
})
