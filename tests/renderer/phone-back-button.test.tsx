import { act, render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../src/phone/App'
import { handleBack, listenForBack, useBackHandler } from '../../src/phone/backButton'
import { fakeEngine, stubCamera, stubVideo } from './scanFakes'
import { fakeStore, installPhoneApi, json, setOnline, stubFetch } from './phoneFakes'

describe('back handlers', () => {
  it('has nothing to do when nothing is open', () => {
    expect(handleBack()).toBe(false)
  })

  it('goes to the newest handler first, then the one under it', () => {
    const page = vi.fn()
    const sheet = vi.fn()
    renderHook(() => useBackHandler(true, page))
    const top = renderHook(({ open }) => useBackHandler(open, sheet), {
      initialProps: { open: true }
    })

    expect(handleBack()).toBe(true)
    expect(sheet).toHaveBeenCalledTimes(1)
    expect(page).not.toHaveBeenCalled()

    top.rerender({ open: false })
    expect(handleBack()).toBe(true)
    expect(page).toHaveBeenCalledTimes(1)
    expect(sheet).toHaveBeenCalledTimes(1)
  })

  it('calls the latest onBack a handler was given', () => {
    const first = vi.fn()
    const second = vi.fn()
    const hook = renderHook(({ cb }) => useBackHandler(true, cb), { initialProps: { cb: first } })
    hook.rerender({ cb: second })
    handleBack()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    hook.unmount()
    expect(handleBack()).toBe(false)
  })
})

describe('listenForBack', () => {
  function fakeButton(): {
    press: () => void
    exit: ReturnType<typeof vi.fn>
    plugin: Parameters<typeof listenForBack>[0]
  } {
    let listener: () => void = () => {}
    const exit = vi.fn(async () => {})
    return {
      press: () => listener(),
      exit,
      plugin: {
        addListener: async (_event: 'back', cb: () => void) => {
          listener = cb
          return { remove: async () => {} }
        },
        exit
      }
    }
  }

  it('leaves the app when nothing is open', async () => {
    const button = fakeButton()
    await listenForBack(button.plugin)
    button.press()
    expect(button.exit).toHaveBeenCalledTimes(1)
  })

  it('stays in the app when something takes the back', async () => {
    const button = fakeButton()
    await listenForBack(button.plugin)
    const close = vi.fn()
    const sheet = renderHook(() => useBackHandler(true, close))
    button.press()
    expect(close).toHaveBeenCalledTimes(1)
    expect(button.exit).not.toHaveBeenCalled()
    sheet.unmount()
  })
})

describe('back in the phone app', () => {
  beforeEach(() => {
    localStorage.clear()
    stubVideo()
    stubCamera()
    setOnline(true)
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { persist: vi.fn(async () => true), persisted: vi.fn(async () => true) }
    })
    stubFetch({ '/api/me': () => json({ error: 'unauthorized' }, 401) })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.api = undefined as never
  })

  const tab = (name: string): HTMLElement =>
    within(screen.getByRole('navigation', { name: 'Tabs' })).getByRole('button', { name })

  it('closes an open sheet, then goes Home, then has nothing left', async () => {
    const user = userEvent.setup()
    const store = fakeStore()
    installPhoneApi(store)
    render(<App store={store} onFatal={() => () => {}} engineFactory={() => fakeEngine()} />)
    await screen.findByRole('navigation', { name: 'Tabs' })

    await user.click(tab('Collection'))
    expect(await screen.findByRole('heading', { name: 'Collection' })).toBeInTheDocument()
    await user.click(tab('More'))
    await screen.findByRole('dialog', { name: 'More' })

    act(() => void handleBack())
    expect(screen.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Collection' })).toBeInTheDocument()

    act(() => void handleBack())
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()

    expect(handleBack()).toBe(false)
  })

  it('closes the scanner', async () => {
    const user = userEvent.setup()
    const store = fakeStore()
    installPhoneApi(store)
    render(<App store={store} onFatal={() => () => {}} engineFactory={() => fakeEngine()} />)
    await screen.findByRole('navigation', { name: 'Tabs' })
    await user.click(tab('Scan'))
    await screen.findByRole('button', { name: 'Close scanner' })

    act(() => void handleBack())
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(handleBack()).toBe(false)
  })
})
