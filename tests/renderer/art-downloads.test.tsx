import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImageDownloads } from '@shared/types'
import { ArtDownloads } from '@/components/ArtDownloads'
import { downloadsLabel, SHOW_AFTER_MS } from '@/components/useImageDownloads'
import { createMockApi } from './mockApi'

const d = (cards: [number, number], sets: [number, number] = [0, 0]): ImageDownloads => ({
  cards: { done: cards[0], total: cards[1] },
  sets: { done: sets[0], total: sets[1] }
})

function setup(): (next: ImageDownloads) => void {
  let emit: (next: ImageDownloads) => void = () => {}
  const api = createMockApi()
  api.images.onDownloads = vi.fn((cb) => {
    emit = cb
    return () => {}
  })
  window.api = api
  render(<ArtDownloads />)
  return (next) => act(() => emit(next))
}

afterEach(() => vi.useRealTimers())

describe('ArtDownloads', () => {
  it('shows real counts once a big burst has run a moment, and goes when the queue empties', () => {
    vi.useFakeTimers()
    const emit = setup()
    emit(d([0, 300]))
    expect(screen.queryByTestId('art-downloads')).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(SHOW_AFTER_MS))
    emit(d([1240, 1300], [0, 0]))
    expect(screen.getByTestId('art-downloads')).toHaveTextContent(
      'Downloading card art1,240 of 1,300'
    )
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1240')
    emit(d([0, 0]))
    expect(screen.queryByTestId('art-downloads')).not.toBeInTheDocument()
  })

  it('stays quiet for a handful of images', () => {
    vi.useFakeTimers()
    const emit = setup()
    emit(d([0, 3]))
    act(() => vi.advanceTimersByTime(SHOW_AFTER_MS * 3))
    emit(d([1, 3]))
    expect(screen.queryByTestId('art-downloads')).not.toBeInTheDocument()
  })

  it('names what is downloading', () => {
    expect(downloadsLabel(d([0, 5]))).toBe('card art')
    expect(downloadsLabel(d([0, 0], [0, 5]))).toBe('set art')
    expect(downloadsLabel(d([0, 5], [0, 5]))).toBe('card and set art')
  })
})
