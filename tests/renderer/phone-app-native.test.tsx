import { render } from '@testing-library/react'
import { App } from '../../src/phone/App'
import { exitStream } from '../../src/phone/stream/device'
import { fakeEngine } from './scanFakes'
import { fakeStore } from './phoneFakes'

const native = vi.hoisted(() => ({ on: false }))
vi.mock('@/lib/portal', async (orig) => ({
  ...(await orig<typeof import('@/lib/portal')>()),
  isNativeApp: () => native.on
}))
vi.mock('../../src/phone/stream/device', () => ({
  enterStream: vi.fn(async () => ({ awake: true })),
  reacquireStream: vi.fn(async () => {}),
  exitStream: vi.fn(async () => {})
}))

function renderApp(): void {
  const engine = fakeEngine()
  render(<App store={fakeStore()} onFatal={() => () => {}} engineFactory={() => engine} />)
}

beforeEach(() => vi.mocked(exitStream).mockClear())

describe('phone app start, native', () => {
  it('puts a reloaded page upright and free to sleep, once', () => {
    native.on = true
    renderApp()
    expect(exitStream).toHaveBeenCalledTimes(1)
  })

  it('leaves the web alone', () => {
    native.on = false
    renderApp()
    expect(exitStream).not.toHaveBeenCalled()
  })
})
