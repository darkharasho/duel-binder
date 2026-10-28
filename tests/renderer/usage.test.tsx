import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsPage } from '@/features/settings/SettingsPage'
import {
  USAGE_FLUSH_MS,
  flushUsage,
  resetUsage,
  setUsageEnabled,
  track,
  trackOpen
} from '@/lib/usage'
import { createMockApi, renderWithProviders } from './mockApi'

const report = (): ReturnType<typeof vi.fn> => window.api.usage.report as ReturnType<typeof vi.fn>

beforeEach(() => {
  window.api = createMockApi()
  resetUsage()
  localStorage.clear()
})
afterEach(() => {
  vi.useRealTimers()
  resetUsage()
  localStorage.clear()
})

describe('usage counts', () => {
  it('batches events and sends only the totals after a while', () => {
    vi.useFakeTimers()
    trackOpen()
    trackOpen()
    track('page:sets')
    track('page:sets')
    track('card:add')
    expect(report()).not.toHaveBeenCalled()
    vi.advanceTimersByTime(USAGE_FLUSH_MS)
    expect(report()).toHaveBeenCalledExactlyOnceWith({ open: 1, 'page:sets': 2, 'card:add': 1 })
    vi.advanceTimersByTime(USAGE_FLUSH_MS)
    expect(report()).toHaveBeenCalledTimes(1)
  })

  it('sends early when the app is hidden', () => {
    track('rip:pack')
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    expect(report()).toHaveBeenCalledWith({ 'rip:pack': 1 })
  })

  it('counts and sends nothing once turned off, and drops what was waiting', () => {
    track('open')
    setUsageEnabled(false)
    track('card:add')
    flushUsage()
    expect(report()).not.toHaveBeenCalled()
    setUsageEnabled(true)
    track('card:add')
    flushUsage()
    expect(report()).toHaveBeenCalledWith({ 'card:add': 1 })
  })

  it('Settings turns the counts off and remembers it', async () => {
    renderWithProviders(<SettingsPage />, { api: window.api })
    const box = await screen.findByRole('checkbox', { name: /Share anonymous usage counts/ })
    expect(box).toBeChecked()
    await userEvent.click(box)
    expect(box).not.toBeChecked()
    expect(localStorage.getItem('duel-binder-usage-off')).toBe('1')
    expect(screen.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute(
      'href',
      'https://duelbinder.com/privacy'
    )
  })
})
