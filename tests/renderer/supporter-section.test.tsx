import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SupporterStatus } from '@shared/supporter'
import { SupporterSection } from '@/features/settings/SupporterSection'
import { SupporterHeart } from '@/components/SupporterHeart'
import { track } from '@/lib/usage'
import { createMockApi, renderWithProviders } from './mockApi'

vi.mock('@/lib/usage', () => ({ track: vi.fn() }))

const open: SupporterStatus = { enabled: true, hasCustomer: false, supporter: null }
const supporting: SupporterStatus = {
  enabled: true,
  hasCustomer: true,
  supporter: {
    plan: 'year',
    since: '2026-11-16T12:00:00.000Z',
    until: '2027-11-16T00:00:00.000Z',
    cancelling: false,
    showOnSite: false
  }
}

const show = (
  status: SupporterStatus,
  { signedIn = true, store = false, platform = 'linux' } = {}
) => {
  const api = createMockApi({ supporter: { status: vi.fn(async () => status) } })
  ;(api.window as { platform: string }).platform = platform
  const r = renderWithProviders(
    <SupporterSection
      signedIn={signedIn}
      store={store}
      frame={(body) => <section aria-label="Support Duel Binder">{body}</section>}
    />,
    { api }
  )
  return r
}

describe('SupporterSection', () => {
  const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
  beforeEach(() => {
    openSpy.mockClear()
    vi.mocked(track).mockClear()
  })

  it('shows nothing signed out, so a closed tier never shows', () => {
    const { api } = show(open, { signedIn: false })
    expect(screen.queryByRole('region', { name: 'Support Duel Binder' })).toBeNull()
    expect(api.supporter.status).not.toHaveBeenCalled()
  })

  it('shows nothing while checkout is closed and they have never subscribed', async () => {
    const { api } = show({ enabled: false, hasCustomer: false, supporter: null })
    await waitFor(() => expect(api.supporter.status).toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: 'Support Duel Binder' })).toBeNull()
  })

  it('offers both plans and opens checkout in the browser on desktop', async () => {
    const { api } = show(open)
    expect(
      await screen.findByText(
        'Hosting, card art and price lookups cost money every month. Supporting keeps the app free for everyone.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '$3 / month' })).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: '$25 / year' }))
    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        'https://checkout.stripe.test/cs_1',
        '_blank',
        'noopener'
      )
    )
    expect(api.supporter.checkout).toHaveBeenCalledWith('year')
    expect(track).toHaveBeenCalledWith('supporter:checkout')
  })

  it('goes to checkout in the same tab on the web', async () => {
    const assign = vi.fn()
    const location = window.location
    Object.defineProperty(window, 'location', {
      value: { ...location, assign },
      configurable: true
    })
    try {
      show(open, { platform: 'web' })
      await userEvent.setup().click(await screen.findByRole('button', { name: '$3 / month' }))
      await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.test/cs_1'))
      expect(openSpy).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(window, 'location', { value: location, configurable: true })
    }
  })

  it('thanks a supporter, opens Manage and sets the thanks-list choice', async () => {
    const { api } = show(supporting)
    expect(await screen.findByText('Thank you — supporter since November 2026')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '$3 / month' })).toBeNull()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Manage' }))
    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        'https://billing.stripe.test/bps_1',
        '_blank',
        'noopener'
      )
    )
    expect(track).toHaveBeenCalledWith('supporter:manage')
    await user.click(screen.getByRole('checkbox', { name: 'Show my name on the thanks page' }))
    await waitFor(() => expect(api.supporter.setShowOnSite).toHaveBeenCalledWith(true))
  })

  it('says when a cancelled subscription ends', async () => {
    show({ ...supporting, supporter: { ...supporting.supporter!, cancelling: true } })
    expect(await screen.findByText(/Ends .*2027/)).toBeInTheDocument()
  })

  it('keeps supporter status visible even while checkout is closed', async () => {
    show({ ...supporting, enabled: false })
    expect(await screen.findByRole('button', { name: 'Manage' })).toBeInTheDocument()
  })

  it('has no buy buttons in the store apps', async () => {
    const { api } = show(open, { store: true })
    await waitFor(() => expect(api.supporter.status).toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: 'Support Duel Binder' })).toBeNull()
  })

  it('lets a lapsed customer in the store apps reach Manage only', async () => {
    show({ ...open, hasCustomer: true }, { store: true })
    expect(await screen.findByRole('button', { name: 'Manage' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '$3 / month' })).toBeNull()
  })

  it('shows the error when checkout fails', async () => {
    const { api } = show(open)
    vi.mocked(api.supporter.checkout).mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'supporter:checkout': Error: Supporter subscriptions aren't open yet"
      )
    )
    await userEvent.setup().click(await screen.findByRole('button', { name: '$3 / month' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Supporter subscriptions aren't open yet"
    )
    expect(openSpy).not.toHaveBeenCalled()
  })
})

describe('SupporterHeart', () => {
  it('is labelled for screen readers', () => {
    renderWithProviders(<SupporterHeart />)
    expect(screen.getByLabelText('Supporter')).toHaveAttribute('title', 'Supporter')
  })
})
