import { act } from '@testing-library/react'
import { LOOK_FEATURES, type LookModel } from '@shared/scan/look'
import { InPageScanner } from '@/features/scan/InPageScanner'
import { ScanHubProvider } from '@/features/scan/ScanHub'
import type { ScanRow } from '@/features/scan/session'
import { PhoneCamera } from '../../src/phone/PhoneCamera'
import { createMockApi, renderWithProviders } from './mockApi'
import {
  codeFrame,
  fakeBridge,
  fakeEngine,
  printing,
  stubCamera,
  stubVideo,
  type FakeEngine
} from './scanFakes'

// Which scanners read rarity with the look model: the phone's does, the desktop's in-page
// scanner (like the scan window) keeps to the name and frame rules.

const SESSION_KEY = 'scan.session.v1'
const at = LOOK_FEATURES.indexOf('art.chromaFine')

/** A model sure of Secret Rare over Ultimate Rare as the art's colour noise rises. */
const MODEL: LookModel = {
  features: LOOK_FEATURES,
  logOffset: LOOK_FEATURES.map(() => 0),
  mean: LOOK_FEATURES.map(() => 0),
  spread: LOOK_FEATURES.map(() => 1),
  classes: ['Secret Rare', 'Ultimate Rare'],
  weights: [4, 0].map((w) => LOOK_FEATURES.map((_, j) => (j === at ? w : 0))),
  bias: [0, 0],
  temperature: 1,
  minProbability: 0.99
}

/**
 * LOB-EN005 printed as Ultimate and Secret, every frame showing a light silver name (it fits
 * Secret but doesn't tell it from Ultimate, so the rules abstain) and a look the model reads as
 * Secret at about 0.9997.
 */
const BOTH = [
  printing({ rarity: 'Ultimate Rare' }),
  printing({ printingId: 102, rarity: 'Secret Rare' })
]
const showing = (): FakeEngine =>
  fakeEngine(() => ({
    ...codeFrame('LOB-EN005'),
    cues: { nameInk: 'light', nameTint: 'silver', nameContrast: -0.3 },
    look: LOOK_FEATURES.map((_, j) => (j === at ? 2 : 0))
  }))

const run = (ms = 0): Promise<void> =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

const saved = (): ScanRow[] => JSON.parse(localStorage.getItem(SESSION_KEY) ?? '[]') as ScanRow[]

async function scan(scanner: React.ReactNode): Promise<void> {
  renderWithProviders(<ScanHubProvider>{scanner}</ScanHubProvider>, {
    api: createMockApi({
      scan: { printingsByCode: vi.fn(async () => BOTH) },
      scanWindow: fakeBridge().scanWindow
    })
  })
  // Lets the camera open and the engine start before the frames.
  await run()
  await run(1500)
}

beforeEach(() => {
  localStorage.clear()
  stubVideo()
  stubCamera()
  vi.useFakeTimers()
  vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.api = undefined as never
})

describe('the rarity look model by scanner', () => {
  it('the phone scanner picks by the look model where the rules abstain', async () => {
    const engine = showing()
    await scan(<PhoneCamera engineFactory={() => engine} lookModel={MODEL} />)
    expect(saved()[0]).toMatchObject({ printingId: 102, rarity: 'Secret Rare', flag: null })
    expect(engine.analyze.mock.calls.at(-1)?.[1]).toMatchObject({ wantLook: true })
  })

  it('the phone scanner asks for the look features with its own model by default', async () => {
    const engine = fakeEngine()
    await scan(<PhoneCamera engineFactory={() => engine} />)
    expect(engine.analyze).toHaveBeenCalled()
    expect(engine.analyze.mock.calls.every(([, o]) => o.wantLook === true)).toBe(true)
  })

  it("the desktop's in-page scanner keeps to the rules and doesn't measure the look", async () => {
    const engine = showing()
    await scan(<InPageScanner engineFactory={() => engine} onCamera={() => {}} controls={null} />)
    expect(saved()[0]).toMatchObject({ printingId: 101, rarity: 'Ultimate Rare' })
    expect(saved()[0].flag).toBe('check-rarity')
    expect(engine.analyze).toHaveBeenCalled()
    expect(engine.analyze.mock.calls.every(([, o]) => o.wantLook === false)).toBe(true)
  })
})
