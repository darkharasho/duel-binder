import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type Database from 'better-sqlite3'
import { createDataHandlers, type DataChannel } from '../../src/main/ipc/dataHandlers'
import { addEntry } from '../../src/main/repo/collection'
import { App } from '../../src/phone/App'
import type { Api } from '@shared/ipc'
import { PageSwitch, usePages } from '@/components/pageSwitch'
import { seededDb } from '../main/helpers'
import { createMockApi, renderWithProviders } from './mockApi'
import { fakeEngine, stubCamera, stubVideo } from './scanFakes'
import { fakeStore, installPhoneApi, json, setOnline, stubFetch } from './phoneFakes'

// The dashboard's Most valuable ranks every language; clicking a card there opens its entry on
// the Collection page even when the shared language filter hides it. The real repo answers the
// data channels, so list, forCard and stats agree as they do in the app.

let db: Database.Database

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('language.filter', 'en')
  db = await seededDb()
  const ja = (
    db
      .prepare(
        `INSERT INTO card_printings (card_id, language, set_name, set_code, set_rarity)
         VALUES (46986414, 'ja', 'Legend of Blue Eyes White Dragon', 'LB-05', 'Ultra Rare') RETURNING id`
      )
      .get() as { id: number }
  ).id
  db.prepare(
    `INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, 99, 3, '2026-10-20T00:00:00.000Z')`
  ).run(ja)
  addEntry(db, { printingId: ja, imageId: 46986414, quantity: 2 })
  const pot = (
    db.prepare(`SELECT id FROM card_printings WHERE set_code = 'LOB-EN119'`).get() as {
      id: number
    }
  ).id
  addEntry(db, { printingId: pot, imageId: 55144522, quantity: 1 })
})
afterEach(() => db.close())

const handlers = (): Record<DataChannel, (...a: unknown[]) => Promise<unknown>> =>
  createDataHandlers({
    db,
    onEdit: () => {},
    availableGames: () => ['ygo'],
    onGameChanged: () => {}
  })

/** Clicks the Japanese Dark Magician in Most valuable and expects its panel, filter untouched. */
async function clickAndExpectPanel(): Promise<void> {
  const section = (await screen.findByRole('heading', { name: 'Most valuable' })).closest(
    'section'
  )!
  const card = (await within(section).findAllByRole('button', { name: /LB-05/ }))[0]
  await userEvent.click(card)
  const dialog = await screen.findByRole('dialog')
  expect(await within(dialog).findByRole('heading', { name: 'Dark Magician' })).toBeVisible()
  await waitFor(() =>
    expect(within(dialog).getByRole('button', { current: true })).toHaveTextContent('LB-05')
  )
  expect(localStorage.getItem('language.filter')).toBe('en')
}

describe.each(['linux', 'phone'])('Most valuable on %s (page switch)', (platform) => {
  function realApi(): Api {
    const h = handlers()
    return createMockApi({
      window: { platform },
      cards: { get: (id: number) => h['cards:get'](id) },
      collection: {
        list: (f: unknown) => h['collection:list'](f),
        forCard: (id: number) => h['collection:forCard'](id),
        facets: () => h['collection:facets']()
      },
      stats: { get: () => h['stats:get']() },
      sets: { list: () => h['sets:list']() }
    } as never)
  }
  function Pages(): React.JSX.Element {
    const pages = usePages('dashboard')
    return <PageSwitch pages={pages} scan={null} rip={null} settings={null} />
  }

  it.each(['total', 'single'])(
    'opens a Japanese entry under the English filter (by %s)',
    async (by) => {
      localStorage.setItem('dashboard.mostValuableBy', by)
      renderWithProviders(<Pages />, { api: realApi() })
      await clickAndExpectPanel()
    }
  )
})

describe('Most valuable in the phone app', () => {
  beforeEach(() => {
    stubVideo()
    stubCamera()
    setOnline(true)
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { persist: vi.fn(async () => true), persisted: vi.fn(async () => true) }
    })
    stubFetch({ '/api/me': () => json({ error: 'unauthorized' }, 401) })
    window.history.replaceState(null, '', '/scan/')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.api = undefined as never
  })

  // The unfiltered list answers last, as a full collection would on a phone.
  it.each(['total', 'single'])(
    'opens a Japanese entry under the English filter (by %s)',
    async (by) => {
      localStorage.setItem('dashboard.mostValuableBy', by)
      const h = handlers()
      const store = fakeStore({
        invoke: vi.fn(async (channel: DataChannel, args: unknown[]) => {
          const f = args[0] as { language?: string } | undefined
          if (channel === 'collection:list')
            await new Promise((r) => setTimeout(r, f?.language ? 20 : 150))
          return h[channel](...args)
        })
      })
      installPhoneApi(store)
      const engine = fakeEngine()
      render(<App store={store} onFatal={() => () => {}} engineFactory={() => engine} />)
      await clickAndExpectPanel()
    }
  )
})
