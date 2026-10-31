import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import type { Mock } from 'vitest'
import type { Api } from '@shared/ipc'
import type { Language } from '@shared/languages'
import type { ChecklistCard, SetSummary } from '@shared/types'
import { SetChecklist } from '@/features/sets/SetChecklist'
import { SetsPage } from '@/features/sets/SetsPage'
import { queryKeys } from '@/lib/api'
import { createMockApi, renderWithProviders } from './mockApi'
import { detailOf, metalRaidersChecklist, PRINTING } from './setFixtures'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

/** sets.adjust mock: keeps a counter per printing; each call resolves only when released. */
function createAdjust(): {
  adjust: Mock<Api['sets']['adjust']>
  pending: () => number
  releaseNext: () => void
  rejectNext: (e: Error) => void
} {
  const owned = new Map<number, number>()
  for (const card of metalRaidersChecklist.cards)
    for (const r of card.rarities) for (const c of r.codes) owned.set(c.printingId, c.owned)

  const updated = (cardId: number): ChecklistCard => {
    const card = metalRaidersChecklist.cards.find((c) => c.cardId === cardId)!
    const rarities = card.rarities.map((r) => {
      const codes = r.codes.map((c) => ({ ...c, owned: owned.get(c.printingId)! }))
      return { ...r, codes, owned: codes.reduce((n, c) => n + c.owned, 0) }
    })
    return { ...card, rarities, owned: rarities.reduce((n, r) => n + r.owned, 0) }
  }

  const queue: ((e?: Error) => void)[] = []
  const adjust = vi.fn<Api['sets']['adjust']>(
    (_setName: string, _language: Language, printingId: number, delta: 1 | -1) =>
      new Promise<ChecklistCard>((resolve, reject) => {
        queue.push((e) => {
          if (e) return reject(e)
          owned.set(printingId, owned.get(printingId)! + delta)
          const card = metalRaidersChecklist.cards.find((c) =>
            c.rarities.some((r) => r.codes.some((x) => x.printingId === printingId))
          )!
          resolve(updated(card.cardId))
        })
      })
  )
  return {
    adjust,
    pending: () => queue.length,
    releaseNext: () => queue.shift()!(),
    rejectNext: (e) => queue.shift()!(e)
  }
}

function setup(
  language: Language = 'en',
  onBack: () => void = () => {}
): ReturnType<typeof createAdjust> & {
  checklist: ReturnType<typeof vi.fn>
  invalidate: ReturnType<typeof vi.spyOn>
  cancel: ReturnType<typeof vi.spyOn>
} {
  const adj = createAdjust()
  const checklist = vi.fn(async () => metalRaidersChecklist)
  const api = createMockApi({
    sets: { checklist, adjust: adj.adjust },
    cards: { get: async (id: number) => detailOf(id) }
  })
  const { client } = renderWithProviders(
    <SetChecklist
      setName="Metal Raiders"
      language={language}
      mode="cards"
      onModeChange={() => {}}
      onBack={onBack}
      onAddMissing={() => {}}
    />,
    { api }
  )
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const cancel = vi.spyOn(client, 'cancelQueries')
  return { ...adj, checklist, invalidate, cancel }
}

async function enterBulk(): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: 'Bulk add' }))
}

const row = (name: string): HTMLElement => screen.getByRole('group', { name })
const bulkBox = (): HTMLElement =>
  screen.getByRole('searchbox', { name: 'Type a card number or name' })

describe('SetChecklist bulk mode', () => {
  it('Bulk add shows a stepper per rarity with the default code selected', async () => {
    setup()
    await enterBulk()
    expect(screen.getByText('Changes save as you click.')).toBeInTheDocument()
    expect(row('Alpha Dragon Secret Rare')).toBeInTheDocument()
    expect(row('Alpha Dragon Ultra Rare')).toBeInTheDocument()
    expect(within(row('Alpha Dragon Secret Rare')).getByText('MRD-001')).toBeInTheDocument()
    expect(
      screen.getByRole('combobox', { name: 'Set code for Alpha Dragon Ultra Rare' })
    ).toHaveTextContent('MRD-E001')
    expect(screen.queryByRole('button', { name: /^Alpha Dragon/ })).not.toBeInTheDocument()
  })

  it('entering bulk focuses its own search and hides the header one', async () => {
    setup()
    await enterBulk()
    expect(screen.getByRole('searchbox', { name: 'Type a card number or name' })).toHaveFocus()
    expect(screen.queryByRole('searchbox', { name: 'Search this set' })).not.toBeInTheDocument()
  })

  it('the bulk search filters tiles by number and name', async () => {
    setup()
    await enterBulk()
    const box = screen.getByRole('searchbox', { name: 'Type a card number or name' })
    await userEvent.type(box, '2')
    expect(screen.getAllByRole('group')).toHaveLength(1)
    expect(row('Beta Knight Common')).toBeInTheDocument()
    await userEvent.clear(box)
    await userEvent.type(box, 'alpha')
    expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual([
      'Alpha Dragon Secret Rare',
      'Alpha Dragon Ultra Rare'
    ])
    await userEvent.clear(box)
    await userEvent.type(box, 'zzz')
    expect(screen.getByText('No cards in this set match \u201Czzz\u201D')).toBeInTheDocument()
  })

  it('clearing the search shows the same tiles again instead of rebuilding them', async () => {
    setup()
    await enterBulk()
    const tile = row('Alpha Dragon Secret Rare')
    await userEvent.type(bulkBox(), '2')
    expect(screen.queryByRole('group', { name: 'Alpha Dragon Secret Rare' })).toBeNull()
    await userEvent.clear(bulkBox())
    expect(row('Alpha Dragon Secret Rare')).toBe(tile)
  })

  it('clicking a tile keeps focus in the box, so typing and Enter still work', async () => {
    const { adjust } = setup()
    await enterBulk()
    const box = bulkBox()
    expect(box).toHaveFocus()
    await userEvent.click(
      screen.getByRole('button', { name: 'Add one Alpha Dragon Secret Rare (photo)' })
    )
    expect(box).toHaveFocus()
    await userEvent.type(box, '10{Enter}')
    expect(adjust).toHaveBeenLastCalledWith('Metal Raiders', 'en', PRINTING.gammaEN010, 1)
    expect(box).toHaveFocus()
  })

  it('a picked code survives filtering', async () => {
    const { adjust } = setup()
    await enterBulk()
    await userEvent.click(
      screen.getByRole('combobox', { name: 'Set code for Alpha Dragon Ultra Rare' })
    )
    await userEvent.click(
      await screen.findByRole('option', { name: /^MRD-EN001 Metal Raiders - / })
    )
    const box = screen.getByRole('searchbox', { name: 'Type a card number or name' })
    await userEvent.type(box, 'beta')
    await userEvent.clear(box)
    await userEvent.click(screen.getByRole('button', { name: 'Add one Alpha Dragon Ultra Rare' }))
    expect(adjust).toHaveBeenCalledWith('Metal Raiders', 'en', PRINTING.alphaUltraEN001, 1)
  })

  it('the header search is kept across bulk mode and the bulk box starts empty', async () => {
    setup()
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Search this set' }), 'gamma')
    await enterBulk()
    expect(screen.getByRole('searchbox', { name: 'Type a card number or name' })).toHaveValue('')
    expect(screen.getAllByRole('group')).toHaveLength(4)
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('searchbox', { name: 'Search this set' })).toHaveValue('gamma')
  })

  it('clicking the photo adds one', async () => {
    const { adjust } = setup()
    await enterBulk()
    await userEvent.click(screen.getByRole('button', { name: 'Add one Gamma Trap Rare (photo)' }))
    expect(adjust).toHaveBeenCalledWith('Metal Raiders', 'en', PRINTING.gammaEN010, 1)
  })

  it("adjusts in the open set's language", async () => {
    const { adjust } = setup('ja')
    await enterBulk()
    await userEvent.click(screen.getByRole('button', { name: 'Add one Gamma Trap Rare' }))
    expect(adjust).toHaveBeenCalledWith('Metal Raiders', 'ja', PRINTING.gammaEN010, 1)
  })

  it('counts rapid clicks at once, serialises them and settles on the server count', async () => {
    const { adjust, releaseNext, pending } = setup()
    await enterBulk()
    const plus = screen.getByRole('button', { name: 'Add one Gamma Trap Rare' })
    await userEvent.click(plus)
    await userEvent.click(plus)
    await userEvent.click(plus)
    expect(adjust).toHaveBeenCalledTimes(1)
    expect(adjust).toHaveBeenCalledWith('Metal Raiders', 'en', PRINTING.gammaEN010, 1)
    // Every click shows before any answer arrives.
    expect(within(row('Gamma Trap Rare')).getByText('3')).toBeInTheDocument()
    expect(screen.getByText(/2 of 3/)).toBeInTheDocument()

    // An answer for the first click keeps the two still in flight on top.
    releaseNext()
    await waitFor(() => expect(adjust).toHaveBeenCalledTimes(2))
    expect(within(row('Gamma Trap Rare')).getByText('3')).toBeInTheDocument()

    expect(pending()).toBe(1)
    releaseNext()
    await waitFor(() => expect(adjust).toHaveBeenCalledTimes(3))
    releaseNext()
    await waitFor(() => expect(within(row('Gamma Trap Rare')).getByText('3')).toBeInTheDocument())
    expect(adjust).toHaveBeenCalledTimes(3)
    for (const call of adjust.mock.calls)
      expect(call).toEqual(['Metal Raiders', 'en', PRINTING.gammaEN010, 1])
  })

  it('cancels in-flight checklist fetches before writing a bulk result', async () => {
    const { releaseNext, cancel } = setup()
    await enterBulk()
    await userEvent.click(screen.getByRole('button', { name: 'Add one Gamma Trap Rare' }))
    releaseNext()
    await waitFor(() =>
      expect(cancel).toHaveBeenCalledWith({
        queryKey: queryKeys.setChecklist('Metal Raiders', 'en')
      })
    )
  })

  it('remove is disabled when the selected code is not owned', async () => {
    setup()
    await enterBulk()
    expect(screen.getByRole('button', { name: 'Remove one Beta Knight Common' })).toBeDisabled()
  })

  it('two rows of one card share a queue and apply in order', async () => {
    const { adjust, releaseNext, checklist, invalidate } = setup()
    await enterBulk()
    await userEvent.click(screen.getByRole('button', { name: 'Add one Alpha Dragon Secret Rare' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove one Alpha Dragon Ultra Rare' })
    )
    expect(adjust).toHaveBeenCalledTimes(1)
    expect(adjust).toHaveBeenNthCalledWith(1, 'Metal Raiders', 'en', PRINTING.alphaSecret, 1)

    releaseNext()
    await waitFor(() => expect(adjust).toHaveBeenCalledTimes(2))
    expect(adjust).toHaveBeenNthCalledWith(2, 'Metal Raiders', 'en', PRINTING.alphaUltraE001, -1)
    releaseNext()

    await waitFor(() =>
      expect(within(row('Alpha Dragon Ultra Rare')).getByText('1')).toBeInTheDocument()
    )
    expect(within(row('Alpha Dragon Secret Rare')).getByText('1')).toBeInTheDocument()

    expect(checklist).toHaveBeenCalledTimes(1)
    // The set list is patched, not refetched; other lists refresh once the card's clicks are done.
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: [...queryKeys.setsList] })
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['sets'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['stats'] })
    expect(invalidate.mock.calls.filter(([f]) => f?.queryKey?.[0] === 'stats')).toHaveLength(1)
  })

  it('a code picked in the dropdown is the one adjusted', async () => {
    const { adjust } = setup()
    await enterBulk()
    await userEvent.click(
      screen.getByRole('combobox', { name: 'Set code for Alpha Dragon Ultra Rare' })
    )
    await userEvent.click(await screen.findByRole('option', { name: /^MRD-001 Metal Raiders - / }))
    await userEvent.click(screen.getByRole('button', { name: 'Add one Alpha Dragon Ultra Rare' }))
    expect(adjust).toHaveBeenCalledWith('Metal Raiders', 'en', PRINTING.alphaUltra001, 1)
  })

  it('a failed adjust rolls its click back, keeping later clicks', async () => {
    const { releaseNext, rejectNext } = setup()
    await enterBulk()
    const plus = screen.getByRole('button', { name: 'Add one Gamma Trap Rare' })
    await userEvent.click(plus)
    await userEvent.click(plus)
    expect(within(row('Gamma Trap Rare')).getByText('2')).toBeInTheDocument()
    rejectNext(new Error('Database is locked'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Database is locked'))
    await waitFor(() => expect(within(row('Gamma Trap Rare')).getByText('1')).toBeInTheDocument())
    releaseNext()
    await waitFor(() => expect(screen.getByText(/2 of 3/)).toBeInTheDocument())
    expect(within(row('Gamma Trap Rare')).getByText('1')).toBeInTheDocument()
  })

  it('the side panel stepper counts a click before the server answers', async () => {
    const { releaseNext, checklist } = setup()
    await userEvent.click(await screen.findByRole('button', { name: /Gamma Trap/ }))
    const panel = await screen.findByRole('dialog')
    const code = detailOf(3001).printings[0].setCode
    await userEvent.click(
      await within(panel).findByRole('button', { name: `Add one Gamma Trap ${code} Rare` })
    )
    expect(within(panel).getByText('You have 1')).toBeInTheDocument()
    expect(
      within(within(panel).getByRole('group', { name: `Gamma Trap ${code} Rare` })).getByText('1')
    ).toBeInTheDocument()
    expect(checklist).toHaveBeenCalledTimes(1)
    releaseNext()
    // The set page behind the panel refreshes once the click is answered.
    await waitFor(() => expect(checklist).toHaveBeenCalledTimes(2))
  })

  it('a failed adjust toasts and keeps the count', async () => {
    const { adjust } = setup()
    adjust.mockRejectedValueOnce(new Error('Database is locked'))
    await enterBulk()
    await userEvent.click(screen.getByRole('button', { name: 'Add one Gamma Trap Rare' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Database is locked'))
    expect(within(row('Gamma Trap Rare')).getByText('0')).toBeInTheDocument()
  })

  it('the header count moves after a bulk +', async () => {
    const { releaseNext } = setup()
    await enterBulk()
    expect(screen.getByText(/1 of 3/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add one Gamma Trap Rare' }))
    releaseNext()
    await waitFor(() => expect(screen.getByText(/2 of 3/)).toBeInTheDocument())
  })

  it('a +/- patches the set list instead of fetching it again', async () => {
    const adj = createAdjust()
    const list = vi.fn(async () => [metalRaidersChecklist.set])
    const api = createMockApi({
      sets: { list, checklist: async () => metalRaidersChecklist, adjust: adj.adjust }
    })
    const { client } = renderWithProviders(
      <SetsPage onAddCard={() => {}} onAddMissing={() => {}} />,
      { api }
    )
    await userEvent.click(await screen.findByRole('button', { name: /Metal Raiders/ }))
    await enterBulk()
    const plus = screen.getByRole('button', { name: 'Add one Gamma Trap Rare' })
    await userEvent.click(plus)
    await userEvent.click(plus)
    adj.releaseNext()
    await waitFor(() => expect(adj.adjust).toHaveBeenCalledTimes(2))
    adj.releaseNext()
    await waitFor(() => expect(adj.pending()).toBe(0))
    await waitFor(() =>
      expect(client.getQueryData<SetSummary[]>(queryKeys.setsList)?.[0]).toMatchObject({
        ownedCards: 2,
        ownedRarities: 2
      })
    )
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('remove is disabled when the rarity is owned but the picked code is not', async () => {
    setup()
    await enterBulk()
    const remove = screen.getByRole('button', { name: 'Remove one Alpha Dragon Ultra Rare' })
    expect(remove).toBeEnabled()
    await userEvent.click(
      screen.getByRole('combobox', { name: 'Set code for Alpha Dragon Ultra Rare' })
    )
    await userEvent.click(await screen.findByRole('option', { name: /^MRD-001 Metal Raiders - / }))
    expect(remove).toBeDisabled()
  })

  it('picking a code hands focus back to the search box', async () => {
    setup()
    await enterBulk()
    await userEvent.click(
      screen.getByRole('combobox', { name: 'Set code for Alpha Dragon Ultra Rare' })
    )
    await userEvent.click(await screen.findByRole('option', { name: /^MRD-001 Metal Raiders - / }))
    await waitFor(() =>
      expect(screen.getByRole('searchbox', { name: 'Type a card number or name' })).toHaveFocus()
    )
  })

  it('the filter does not hide a card while it is being changed', async () => {
    const { releaseNext } = setup()
    await screen.findByRole('button', { name: /^Alpha Dragon/ })
    await userEvent.click(screen.getByRole('radio', { name: 'Missing' }))
    await enterBulk()
    expect(screen.queryByRole('group', { name: /^Alpha Dragon/ })).not.toBeInTheDocument()
    const plus = screen.getByRole('button', { name: 'Add one Gamma Trap Rare' })
    await userEvent.click(plus)
    releaseNext()
    await waitFor(() => expect(within(row('Gamma Trap Rare')).getByText('1')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Add one Gamma Trap Rare' }))
    releaseNext()
    await waitFor(() => expect(within(row('Gamma Trap Rare')).getByText('2')).toBeInTheDocument())
  })

  it('highlights the first tile and moves the highlight with the arrow keys', async () => {
    setup()
    await enterBulk()
    expect(row('Alpha Dragon Secret Rare')).toHaveAttribute('data-highlighted', 'true')
    await userEvent.keyboard('{ArrowRight}')
    expect(row('Alpha Dragon Ultra Rare')).toHaveAttribute('data-highlighted', 'true')
    expect(row('Alpha Dragon Secret Rare')).toHaveAttribute('data-highlighted', 'false')
    await userEvent.keyboard('{ArrowLeft}')
    expect(row('Alpha Dragon Secret Rare')).toHaveAttribute('data-highlighted', 'true')
  })

  it('Enter adds the highlighted tile, clears the box and lists it under Just added', async () => {
    const { adjust } = setup()
    await enterBulk()
    await userEvent.type(bulkBox(), '2{Enter}')
    expect(adjust).toHaveBeenCalledWith('Metal Raiders', 'en', PRINTING.beta, 1)
    expect(bulkBox()).toHaveValue('')
    const list = screen.getByRole('list', { name: 'Just added' })
    expect(
      within(list).getByRole('button', { name: 'Undo Beta Knight Common' })
    ).toBeInTheDocument()
    expect(within(list).getByText('MRD-002')).toBeInTheDocument()
  })

  it('Enter with no match adds nothing', async () => {
    const { adjust } = setup()
    await enterBulk()
    await userEvent.type(bulkBox(), 'zzz{Enter}')
    expect(adjust).not.toHaveBeenCalled()
    expect(screen.queryByRole('list', { name: 'Just added' })).not.toBeInTheDocument()
  })

  it('Backspace in the empty box undoes the newest add', async () => {
    const { adjust, releaseNext } = setup()
    await enterBulk()
    await userEvent.type(bulkBox(), '2{Enter}')
    releaseNext()
    await userEvent.keyboard('{Backspace}')
    await waitFor(() =>
      expect(adjust).toHaveBeenLastCalledWith('Metal Raiders', 'en', PRINTING.beta, -1)
    )
    expect(screen.queryByRole('list', { name: 'Just added' })).not.toBeInTheDocument()
  })

  it("the strip's Undo button removes the card again", async () => {
    const { adjust, releaseNext } = setup()
    await enterBulk()
    await userEvent.type(bulkBox(), '2{Enter}')
    releaseNext()
    await userEvent.click(screen.getByRole('button', { name: 'Undo Beta Knight Common' }))
    await waitFor(() =>
      expect(adjust).toHaveBeenLastCalledWith('Metal Raiders', 'en', PRINTING.beta, -1)
    )
    expect(screen.queryByRole('list', { name: 'Just added' })).not.toBeInTheDocument()
  })

  it('a failed add leaves the strip and cannot be undone', async () => {
    const { adjust, rejectNext } = setup()
    await enterBulk()
    await userEvent.type(bulkBox(), '2{Enter}')
    expect(screen.getByRole('list', { name: 'Just added' })).toBeInTheDocument()
    rejectNext(new Error('x'))
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Just added' })).not.toBeInTheDocument()
    )
    await userEvent.keyboard('{Backspace}')
    expect(adjust).toHaveBeenCalledTimes(1)
  })

  it('Undo before the add saves sends no remove when the add fails', async () => {
    const { adjust, rejectNext } = setup()
    await enterBulk()
    await userEvent.type(bulkBox(), '2{Enter}')
    await userEvent.keyboard('{Backspace}')
    expect(screen.queryByRole('list', { name: 'Just added' })).not.toBeInTheDocument()
    rejectNext(new Error('x'))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(adjust).toHaveBeenCalledTimes(1)
    expect(adjust).not.toHaveBeenCalledWith('Metal Raiders', 'en', PRINTING.beta, -1)
  })

  it('Undo before the add saves sends the remove once it has saved', async () => {
    const { adjust, releaseNext } = setup()
    await enterBulk()
    await userEvent.type(bulkBox(), '2{Enter}')
    await userEvent.keyboard('{Backspace}')
    expect(screen.queryByRole('list', { name: 'Just added' })).not.toBeInTheDocument()
    expect(adjust).toHaveBeenCalledTimes(1)
    releaseNext()
    await waitFor(() =>
      expect(adjust).toHaveBeenLastCalledWith('Metal Raiders', 'en', PRINTING.beta, -1)
    )
    expect(adjust).toHaveBeenCalledTimes(2)
  })

  it('two quick Backspaces undo two different adds', async () => {
    const { adjust, releaseNext } = setup()
    await enterBulk()
    await userEvent.type(bulkBox(), '2{Enter}')
    await userEvent.type(bulkBox(), '10{Enter}')
    releaseNext()
    await waitFor(() => expect(adjust).toHaveBeenCalledTimes(2))
    releaseNext()
    await userEvent.keyboard('{Backspace}{Backspace}')
    await waitFor(() => expect(adjust).toHaveBeenCalledTimes(4))
    const removes = adjust.mock.calls.filter((c) => c[3] === -1).map((c) => c[2])
    expect(removes).toEqual(expect.arrayContaining([PRINTING.beta, PRINTING.gammaEN010]))
    expect(screen.queryByRole('list', { name: 'Just added' })).not.toBeInTheDocument()
  })

  it('a second Enter on the cleared box adds nothing; an arrow then Enter does', async () => {
    const { adjust } = setup()
    await enterBulk()
    await userEvent.type(bulkBox(), '2{Enter}')
    await userEvent.keyboard('{Enter}')
    expect(adjust).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('{ArrowRight}{Enter}')
    expect(adjust).toHaveBeenCalledTimes(2)
  })

  it('clicking the photo lists the card under Just added', async () => {
    setup()
    await enterBulk()
    await userEvent.click(screen.getByRole('button', { name: 'Add one Gamma Trap Rare (photo)' }))
    expect(
      within(screen.getByRole('list', { name: 'Just added' })).getByRole('button', {
        name: 'Undo Gamma Trap Rare'
      })
    ).toBeInTheDocument()
  })

  it('the highlight stays on its tile when the counts change', async () => {
    const { releaseNext } = setup()
    await enterBulk()
    await userEvent.keyboard('{ArrowRight}')
    await userEvent.click(screen.getByRole('button', { name: 'Add one Alpha Dragon Ultra Rare' }))
    expect(screen.getByRole('button', { name: 'Undo Alpha Dragon Ultra Rare' })).toBeInTheDocument()
    releaseNext()
    await waitFor(() =>
      expect(within(row('Alpha Dragon Ultra Rare')).getByText('3')).toBeInTheDocument()
    )
    expect(row('Alpha Dragon Ultra Rare')).toHaveAttribute('data-highlighted', 'true')
  })

  it('Escape clears the box without leaving the set', async () => {
    const onBack = vi.fn()
    setup('en', onBack)
    await enterBulk()
    await userEvent.type(bulkBox(), 'beta')
    await userEvent.keyboard('{Escape}')
    expect(bulkBox()).toHaveValue('')
    expect(onBack).not.toHaveBeenCalled()
  })

  it('a tile minus does not join the strip', async () => {
    const { adjust } = setup()
    await enterBulk()
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove one Alpha Dragon Ultra Rare' })
    )
    expect(adjust).toHaveBeenCalledWith('Metal Raiders', 'en', PRINTING.alphaUltraE001, -1)
    expect(screen.queryByRole('list', { name: 'Just added' })).not.toBeInTheDocument()
  })

  it('leaving bulk mode clears the strip', async () => {
    setup()
    await enterBulk()
    await userEvent.type(bulkBox(), '2{Enter}')
    expect(screen.getByRole('list', { name: 'Just added' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    await enterBulk()
    expect(screen.queryByRole('list', { name: 'Just added' })).not.toBeInTheDocument()
  })

  it('Done restores tiles', async () => {
    setup()
    await enterBulk()
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('button', { name: /^Alpha Dragon/ })).toBeInTheDocument()
    expect(screen.queryByText('Changes save as you click.')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Gamma Trap Rare' })).not.toBeInTheDocument()
  })
})
