import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import type { Mock } from 'vitest'
import type { Api } from '@shared/ipc'
import type { Language } from '@shared/languages'
import type { ChecklistCard } from '@shared/types'
import { SetChecklist } from '@/features/sets/SetChecklist'
import { queryKeys } from '@/lib/api'
import { createMockApi, renderWithProviders } from './mockApi'
import { metalRaidersChecklist, PRINTING } from './setFixtures'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

/** sets.adjust mock: keeps a counter per printing; each call resolves only when released. */
function createAdjust(): {
  adjust: Mock<Api['sets']['adjust']>
  pending: () => number
  releaseNext: () => void
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

  const queue: (() => void)[] = []
  const adjust = vi.fn<Api['sets']['adjust']>(
    (_setName: string, _language: Language, printingId: number, delta: 1 | -1) =>
      new Promise<ChecklistCard>((resolve) => {
        queue.push(() => {
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
    releaseNext: () => queue.shift()!()
  }
}

function setup(language: Language = 'en'): ReturnType<typeof createAdjust> & {
  checklist: ReturnType<typeof vi.fn>
  invalidate: ReturnType<typeof vi.spyOn>
  cancel: ReturnType<typeof vi.spyOn>
} {
  const adj = createAdjust()
  const checklist = vi.fn(async () => metalRaidersChecklist)
  const api = createMockApi({ sets: { checklist, adjust: adj.adjust } })
  const { client } = renderWithProviders(
    <SetChecklist
      setName="Metal Raiders"
      language={language}
      mode="cards"
      onModeChange={() => {}}
      onBack={() => {}}
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

describe('SetChecklist bulk mode', () => {
  it('Bulk add shows a stepper per rarity with the default code selected', async () => {
    setup()
    await enterBulk()
    expect(screen.getByText('Changes save as you click.')).toBeInTheDocument()
    expect(row('Alpha Dragon Secret Rare')).toBeInTheDocument()
    expect(row('Alpha Dragon Ultra Rare')).toBeInTheDocument()
    expect(
      within(row('Alpha Dragon Secret Rare')).getByText('Secret Rare · MRD-001')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('combobox', { name: 'Set code for Alpha Dragon Ultra Rare' })
    ).toHaveTextContent('MRD-E001')
    expect(screen.queryByRole('button', { name: /^Alpha Dragon/ })).not.toBeInTheDocument()
  })

  it("adjusts in the open set's language", async () => {
    const { adjust } = setup('ja')
    await enterBulk()
    await userEvent.click(screen.getByRole('button', { name: 'Add one Gamma Trap Rare' }))
    expect(adjust).toHaveBeenCalledWith('Metal Raiders', 'ja', PRINTING.gammaEN010, 1)
  })

  it('serialises rapid clicks and shows the server count', async () => {
    const { adjust, releaseNext, pending } = setup()
    await enterBulk()
    const plus = screen.getByRole('button', { name: 'Add one Gamma Trap Rare' })
    await userEvent.click(plus)
    await userEvent.click(plus)
    await userEvent.click(plus)
    expect(adjust).toHaveBeenCalledTimes(1)
    expect(adjust).toHaveBeenCalledWith('Metal Raiders', 'en', PRINTING.gammaEN010, 1)
    expect(within(row('Gamma Trap Rare')).getByText('0')).toBeInTheDocument()

    releaseNext()
    await waitFor(() => expect(adjust).toHaveBeenCalledTimes(2))
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
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [...queryKeys.setsList] })
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['sets'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['stats'] })
  })

  it('a code picked in the dropdown is the one adjusted', async () => {
    const { adjust } = setup()
    await enterBulk()
    await userEvent.click(
      screen.getByRole('combobox', { name: 'Set code for Alpha Dragon Ultra Rare' })
    )
    await userEvent.click(await screen.findByRole('option', { name: 'MRD-001' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add one Alpha Dragon Ultra Rare' }))
    expect(adjust).toHaveBeenCalledWith('Metal Raiders', 'en', PRINTING.alphaUltra001, 1)
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

  it('remove is disabled when the rarity is owned but the picked code is not', async () => {
    setup()
    await enterBulk()
    const remove = screen.getByRole('button', { name: 'Remove one Alpha Dragon Ultra Rare' })
    expect(remove).toBeEnabled()
    await userEvent.click(
      screen.getByRole('combobox', { name: 'Set code for Alpha Dragon Ultra Rare' })
    )
    await userEvent.click(await screen.findByRole('option', { name: 'MRD-001' }))
    expect(remove).toBeDisabled()
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

  it('Done restores tiles', async () => {
    setup()
    await enterBulk()
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('button', { name: /^Alpha Dragon/ })).toBeInTheDocument()
    expect(screen.queryByText('Changes save as you click.')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Gamma Trap Rare' })).not.toBeInTheDocument()
  })
})
