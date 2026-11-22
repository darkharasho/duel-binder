import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { TermNotes } from '@/components/TermNotes'
import { createMockApi, renderWithProviders } from './mockApi'

describe('TermNotes', () => {
  it('shows one line per matched term', async () => {
    const explain = vi.fn(async () => [
      { phrase: 'bubble mew', label: 'Mew ex · Paldean Fates 232/91' }
    ])
    renderWithProviders(<TermNotes q="bubble mew" />, {
      api: createMockApi({ cards: { explain } })
    })
    expect(
      await screen.findByText('“bubble mew” — Mew ex · Paldean Fates 232/91')
    ).toBeInTheDocument()
    expect(explain).toHaveBeenCalledWith('bubble mew')
  })

  it('renders nothing when no term matched', async () => {
    const explain = vi.fn(async () => [])
    const { container } = renderWithProviders(<TermNotes q="pikachu" />, {
      api: createMockApi({ cards: { explain } })
    })
    await waitFor(() => expect(explain).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
