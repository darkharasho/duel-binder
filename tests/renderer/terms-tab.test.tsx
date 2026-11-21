import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import type { AdminTerm } from '@shared/admin'
import { TermsTab } from '@/features/admin/TermsTab'
import { createMockApi, renderWithProviders } from './mockApi'

afterEach(() => {
  window.api = undefined as never
})

const term = (over: Partial<AdminTerm> = {}): AdminTerm => ({
  id: 7,
  game: 'ygo',
  phrase: 'blue eyes',
  phraseKey: 'blue eyes',
  kind: 'nickname',
  targetKind: 'card',
  target: { cardIds: [4] },
  status: 'pending',
  source: 'ebay-ai',
  seq: 1,
  evidence: {
    titles: ['Blue Eyes <b>LOB</b>'],
    count: 12,
    sellers: 5,
    reason: 'Sellers shorten the name'
  },
  preview: null,
  ...over
})

function setup(pending: AdminTerm[], approved: AdminTerm[] = []) {
  const admin = {
    terms: vi.fn(async (_game: string, status: string) =>
      status === 'pending' ? pending : approved
    ),
    decideTerm: vi.fn(async () => {}),
    addTerm: vi.fn(async () => {})
  }
  const api = createMockApi({})
  api.admin = admin as never
  renderWithProviders(<TermsTab />, { api })
  return admin
}

describe('TermsTab', () => {
  it('approves a pending term and drops its card', async () => {
    const admin = setup([term()])
    expect(await screen.findByText('blue eyes')).toBeInTheDocument()
    expect(screen.getByText('Sellers shorten the name')).toBeInTheDocument()
    expect(screen.getByText('Blue Eyes <b>LOB</b>')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(admin.decideTerm).toHaveBeenCalledWith(7, 'approved', undefined))
    await waitFor(() => expect(screen.queryByText('blue eyes')).not.toBeInTheDocument())
  })

  it('shows the portal refusal when an edit clashes', async () => {
    const admin = setup([term()])
    admin.decideTerm.mockRejectedValueOnce(
      new Error('Another term in this game already uses that phrase.')
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save and approve' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already uses that phrase')
    expect(screen.getByText('blue eyes')).toBeInTheDocument()
  })

  it('removes an approved term and adds a new one', async () => {
    const admin = setup([], [term({ status: 'approved' })])
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(admin.decideTerm).toHaveBeenCalledWith(7, 'rejected', undefined))
    await userEvent.type(screen.getAllByLabelText('Phrase')[0], 'dark mage')
    await userEvent.type(screen.getAllByLabelText('Card ids')[0], '4, 5')
    await userEvent.click(screen.getByRole('button', { name: 'Add term' }))
    await waitFor(() =>
      expect(admin.addTerm).toHaveBeenCalledWith('ygo', {
        phrase: 'dark mage',
        kind: 'nickname',
        targetKind: 'card',
        target: { cardIds: [4, 5] }
      })
    )
  })

  it('refuses a set without a language, on edit and on add', async () => {
    const admin = setup([term()])
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await userEvent.type(screen.getAllByLabelText('Sets (language:name)')[0], 'LOB')
    await userEvent.click(screen.getByRole('button', { name: 'Save and approve' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sets need language:Set name')
    expect(admin.decideTerm).not.toHaveBeenCalled()

    await userEvent.type(screen.getAllByLabelText('Phrase')[1], 'x')
    await userEvent.type(screen.getAllByLabelText('Sets (language:name)')[1], ':LOB')
    await userEvent.click(screen.getByRole('button', { name: 'Add term' }))
    await waitFor(() =>
      expect(
        screen.getAllByRole('alert').some((a) => /language:Set name/.test(a.textContent!))
      ).toBe(true)
    )
    expect(admin.addTerm).not.toHaveBeenCalled()
  })
})
