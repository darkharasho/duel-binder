import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DEFAULT_PREFS, type Prefs } from '@shared/prefs'
import { WashSetting } from '@/features/settings/WashSetting'
import { resetWashStoreForTests } from '@/lib/washPref'
import { createMockApi, renderWithProviders } from './mockApi'

vi.mock('@/lib/friends', () => ({ useFriendsReady: () => false }))

const KEY = 'prefs:v1'
const colours = {
  fams: [{ lab: [50, 10, 10] as [number, number, number], share: 1 }],
  dark: [20, 0, 0] as [number, number, number],
  vivid: 0.5
}

const stored = (): Prefs['wash'] => JSON.parse(localStorage.getItem(KEY) ?? 'null').wash

const seed = (wash: Prefs['wash']): void => localStorage.setItem(KEY, JSON.stringify({ wash }))

const show = (compact = false): void => {
  renderWithProviders(<WashSetting compact={compact} />, { api: createMockApi() })
}

describe('WashSetting', () => {
  beforeEach(() => {
    localStorage.clear()
    resetWashStoreForTests()
  })
  afterEach(() => localStorage.clear())

  it('shows the three options with the current one pressed', () => {
    show()
    expect(screen.getByRole('button', { name: 'Random' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Locked' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Colourless' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  it('Colourless keeps saved colours, so Locked restores them without a new roll', async () => {
    seed({ mode: 'locked', locked: colours })
    show()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Colourless' }))
    expect(stored()).toEqual({ mode: 'colourless', locked: colours })
    expect(screen.getByRole('button', { name: 'Colourless' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await user.click(screen.getByRole('button', { name: 'Locked' }))
    expect(stored()).toEqual({ mode: 'locked', locked: colours })
  })

  it('Colourless with no saved colours saves only the mode', async () => {
    show()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Colourless' }))
    expect(stored()).toEqual({ mode: 'colourless' })
  })

  it('Locked with no colours rolls once and saves them', async () => {
    show()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Locked' }))
    const saved = stored()
    expect(saved.mode).toBe('locked')
    expect(saved.locked?.fams.length).toBeGreaterThan(0)
    expect(saved.locked).not.toHaveProperty('greyArt')
  })

  it('shows Randomize only under Locked, and it saves new colours', async () => {
    seed({ mode: 'colourless', locked: colours })
    show()
    const user = userEvent.setup()
    expect(screen.queryByRole('button', { name: 'Randomize' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Locked' }))
    expect(stored().locked).toEqual(colours)
    const before = JSON.stringify(stored().locked)
    // Make the roll differ: the fallback is random, so retry a few times.
    let changed = false
    for (let i = 0; i < 10 && !changed; i++) {
      await user.click(screen.getByRole('button', { name: 'Randomize' }))
      changed = JSON.stringify(stored().locked) !== before
    }
    expect(changed).toBe(true)
    expect(stored().mode).toBe('locked')
    expect(stored().locked).not.toHaveProperty('greyArt')
  })

  it('Locked with no colours still offers Randomize, which saves colours', async () => {
    seed({ mode: 'locked' })
    show()
    expect(screen.queryByTestId('wash-swatch')).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Randomize' }))
    expect(stored().mode).toBe('locked')
    expect(stored().locked?.fams.length).toBeGreaterThan(0)
  })

  it('keeps the random default untouched when nothing is clicked', () => {
    show(true)
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(DEFAULT_PREFS.wash.mode).toBe('random')
  })
})
