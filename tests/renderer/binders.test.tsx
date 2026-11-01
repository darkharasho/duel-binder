import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BinderCard, BinderDetail, BinderSummary, CardRow } from '@shared/types'
import { BindersPage } from '@/features/binders/BindersPage'
import { BinderView } from '@/features/binders/BinderView'
import { createMockApi, renderWithProviders } from './mockApi'

const summary = (over: Partial<BinderSummary> = {}): BinderSummary => ({
  uid: 'b1',
  name: 'Blue-Eyes',
  goal: 'art',
  languages: ['en', 'ja'],
  friendsVisible: true,
  hasRules: true,
  editable: true,
  ownedSlots: 5,
  missingSlots: 3,
  tooBroad: false,
  coverImageId: 11,
  ...over
})
const slot = (n: number, owned: number, over: Partial<BinderCard> = {}): BinderCard => ({
  key: `art:${n}`,
  level: 'art',
  card: { id: n, name: `Card ${n}`, type: 'Normal Monster', frameType: 'normal' } as CardRow,
  imageId: n,
  printing: null,
  printingScan: false,
  owned,
  added: false,
  price: owned ? null : 4,
  ...over
})
const detail = (over: Partial<BinderDetail> = {}): BinderDetail => ({
  ...summary(),
  rules: { version: 1, rules: [{ field: 'name', op: 'is', value: 'Blue-Eyes White Dragon' }] },
  cards: [slot(1, 1), slot(2, 0), slot(3, 2)],
  valueToFinish: 84,
  unpricedMissing: 0,
  ...over
})

afterEach(() => {
  window.api = undefined as never
})

describe('the binders page', () => {
  it('lists binders with progress, and marks a complete one', async () => {
    const api = createMockApi({
      binders: {
        list: vi.fn(async () => [
          summary(),
          summary({ uid: 'b2', name: 'Dark Magician', ownedSlots: 4, missingSlots: 0 })
        ])
      }
    })
    renderWithProviders(<BindersPage />, { api })
    expect(await screen.findByText('5 of 8 · 3 missing')).toBeInTheDocument()
    expect(screen.getByText('Complete')).toBeInTheDocument()
  })

  it('hides the progress of a binder with no goal', async () => {
    const api = createMockApi({
      binders: {
        list: vi.fn(async () => [
          summary({ goal: 'none', hasRules: false, ownedSlots: 24, missingSlots: 0 })
        ])
      }
    })
    renderWithProviders(<BindersPage />, { api })
    expect(await screen.findByText(/24 cards/)).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('says so when there are no binders, and offers New binder when given', async () => {
    const onNew = vi.fn()
    renderWithProviders(<BindersPage onNew={onNew} />)
    expect(await screen.findByText(/No binders yet/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'New binder' }))
    expect(onNew).toHaveBeenCalled()
  })

  it('opens a binder', async () => {
    const api = createMockApi({
      binders: { list: vi.fn(async () => [summary()]), get: vi.fn(async () => detail()) }
    })
    renderWithProviders(<BindersPage />, { api })
    await userEvent.click(await screen.findByRole('button', { name: /Blue-Eyes/ }))
    expect(await screen.findByRole('heading', { name: 'Blue-Eyes' })).toBeInTheDocument()
    expect(api.binders.get).toHaveBeenCalledWith('b1')
  })
})

describe('a binder', () => {
  it('filters All, Owned and Missing', async () => {
    renderWithProviders(<BinderView detail={detail()} />)
    const grid = screen.getByRole('list', { name: 'Binder cards' })
    expect(within(grid).getAllByRole('listitem')).toHaveLength(3)
    await userEvent.click(screen.getByRole('radio', { name: 'Owned' }))
    expect(within(grid).getAllByRole('listitem')).toHaveLength(2)
    await userEvent.click(screen.getByRole('radio', { name: 'Missing' }))
    expect(within(grid).getAllByRole('listitem')).toHaveLength(1)
    expect(within(grid).getByText('Card 2')).toBeInTheDocument()
  })

  it('shows value to finish, and the unpriced note only when there is one', () => {
    const { unmount } = renderWithProviders(<BinderView detail={detail()} />)
    expect(screen.getByText(/est\. value to finish \$84\.00/)).toBeInTheDocument()
    expect(screen.queryByText(/have no price/)).not.toBeInTheDocument()
    unmount()
    renderWithProviders(<BinderView detail={detail({ unpricedMissing: 2 })} />)
    expect(screen.getByText('2 cards have no price')).toBeInTheDocument()
  })

  it('hides the bar and the filter for a binder with no goal', () => {
    renderWithProviders(<BinderView detail={detail({ goal: 'none' })} />)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Missing' })).not.toBeInTheDocument()
  })

  it('explains a rule that matches too much', () => {
    renderWithProviders(<BinderView detail={detail({ tooBroad: true, cards: [] })} />)
    expect(
      screen.getByText('This rule matches too many cards to track. Edit it to narrow it down.')
    ).toBeInTheDocument()
  })

  it('says a binder this app cannot read must be updated', () => {
    const onEdit = vi.fn()
    renderWithProviders(<BinderView detail={detail({ editable: false })} onEdit={onEdit} />)
    expect(screen.getByText('Update the app to edit this binder.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('offers Edit only when it may be edited', async () => {
    const onEdit = vi.fn()
    const { unmount } = renderWithProviders(<BinderView detail={detail()} onEdit={onEdit} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onEdit).toHaveBeenCalled()
    unmount()
    renderWithProviders(<BinderView detail={detail()} onEdit={onEdit} readOnly />)
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('opens the card panel from a missing slot', async () => {
    renderWithProviders(<BinderView detail={detail()} />)
    await userEvent.click(screen.getByRole('button', { name: /Card 2/ }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('shows a printing scan only when the binder allows it', () => {
    const printing = {
      id: 99,
      cardId: 3,
      setCode: 'LOB-001',
      setRarity: 'Ultra Rare',
      language: 'en'
    } as BinderCard['printing']
    const { unmount } = renderWithProviders(
      <BinderView detail={detail({ cards: [slot(3, 1, { printing, printingScan: false })] })} />
    )
    expect(screen.queryByTestId('printing-scan')).not.toBeInTheDocument()
    unmount()
    renderWithProviders(
      <BinderView detail={detail({ cards: [slot(3, 1, { printing, printingScan: true })] })} />
    )
    expect(screen.getByTestId('printing-scan')).toBeInTheDocument()
  })
})

describe('binder edge cases', () => {
  it('shows a placeholder, not an image, for a card with no art', () => {
    const { container } = renderWithProviders(
      <BinderView detail={detail({ cards: [slot(2, 0, { imageId: 0 })] })} />
    )
    expect(container.querySelector('img')).toBeNull()
  })

  it('shows the remove control only when it may remove', () => {
    const onRemove = vi.fn()
    const { unmount } = renderWithProviders(<BinderView detail={detail()} onRemove={onRemove} />)
    expect(screen.getAllByRole('button', { name: /^Remove Card/ })).toHaveLength(3)
    unmount()
    renderWithProviders(<BinderView detail={detail()} onRemove={onRemove} readOnly />)
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument()
  })

  it('does not call a binder with no slots complete', async () => {
    const empty = { ownedSlots: 0, missingSlots: 0 }
    renderWithProviders(<BinderView detail={detail({ ...empty, cards: [] })} />)
    expect(screen.getByText('Nothing to track yet')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByText('Complete')).not.toBeInTheDocument()
  })

  it('says so in the list for a goal binder with no slots', async () => {
    const api = createMockApi({
      binders: { list: vi.fn(async () => [summary({ ownedSlots: 0, missingSlots: 0 })]) }
    })
    renderWithProviders(<BindersPage />, { api })
    expect(await screen.findByText('Nothing to track yet')).toBeInTheDocument()
    expect(screen.queryByText('Complete')).not.toBeInTheDocument()
    expect(screen.queryByText(/0 of 0/)).not.toBeInTheDocument()
  })
})
