import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { installErrorReports, resetErrorReports } from '@/lib/errorReports'
import { setUsageEnabled } from '@/lib/usage'
import { createMockApi, renderWithProviders } from './mockApi'

const report = (): ReturnType<typeof vi.fn> => window.api.errors.report as ReturnType<typeof vi.fn>
const setEnabled = (): ReturnType<typeof vi.fn> =>
  window.api.errors.setEnabled as ReturnType<typeof vi.fn>

const fire = async (error: unknown): Promise<void> => {
  window.dispatchEvent(new ErrorEvent('error', { error, message: String(error) }))
  await new Promise((r) => setTimeout(r))
}

// Listeners stay for the page, so this installs once; window.api is swapped under them.
beforeAll(() => {
  window.api = createMockApi()
  installErrorReports()
})
beforeEach(() => {
  window.api = createMockApi()
  localStorage.clear()
  resetErrorReports()
})
afterEach(() => localStorage.clear())

describe('error reports', () => {
  it('sends a scrubbed report with only the version, message and stack', async () => {
    const error = new Error('open /home/alice/x failed for jane@example.com')
    error.stack = 'Error\n  at /Users/alice/app.js:1:2'
    await fire(error)
    expect(report()).toHaveBeenCalledExactlyOnceWith({
      appVersion: expect.any(String),
      message: 'open /home/~/x failed for [email]',
      stack: 'Error\n  at /Users/~/app.js:1:2'
    })
  })

  it('reports unhandled rejections', async () => {
    const event = new Event('unhandledrejection') as Event & { reason: unknown }
    event.reason = new Error('nope')
    window.dispatchEvent(event)
    await new Promise((r) => setTimeout(r))
    expect(report().mock.calls[0][0].message).toBe('Unhandled rejection: nope')
  })

  it('sends nothing with the usage setting off', async () => {
    setUsageEnabled(false)
    await fire(new Error('boom'))
    expect(report()).not.toHaveBeenCalled()
  })

  it('sends an identical error once, and at most ten a session', async () => {
    const same = new Error('same')
    await fire(same)
    await fire(same)
    expect(report()).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 20; i++) await fire(new Error(`e${i}`))
    expect(report()).toHaveBeenCalledTimes(10)
  })

  it('never fails or loops on its own failure', async () => {
    report().mockRejectedValue(new Error('portal down'))
    const unhandled = vi.fn()
    window.addEventListener('unhandledrejection', unhandled)
    await fire(new Error('boom'))
    window.removeEventListener('unhandledrejection', unhandled)
    expect(report()).toHaveBeenCalledTimes(1)
    expect(unhandled).not.toHaveBeenCalled()

    window.api = undefined as unknown as typeof window.api
    await expect(fire(new Error('no bridge'))).resolves.toBeUndefined()
    window.api = createMockApi()
  })

  it('tells main when the usage setting changes', () => {
    setUsageEnabled(false)
    expect(setEnabled()).toHaveBeenLastCalledWith(false)
    setUsageEnabled(true)
    expect(setEnabled()).toHaveBeenLastCalledWith(true)
  })

  it('stays on by default, and the Settings toggle says what it covers and turns reports off', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />)
    const box = await screen.findByRole('checkbox', { name: /usage counts and error reports/ })
    expect(box).toBeChecked()
    expect(screen.getByText(/crash and error\s+reports/)).toBeInTheDocument()
    await user.click(box)
    expect(localStorage.getItem('duel-binder-usage-off')).toBe('1')
    expect(setEnabled()).toHaveBeenLastCalledWith(false)
    await fire(new Error('boom'))
    expect(report()).not.toHaveBeenCalled()
  })
})
