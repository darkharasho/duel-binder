import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MakeReplay } from '@/features/scan/replay/MakeReplay'
import { replaySourceOfRows, type ReplaySource } from '@/features/scan/replay/pulls'
import { replayRow as row } from './replayRows'

const src = (...rows: ReturnType<typeof row>[]): ReplaySource => replaySourceOfRows(rows)

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

beforeEach(() => {
  // jsdom has no MediaRecorder; the button offers video only where it can be made.
  vi.stubGlobal('MediaRecorder', { isTypeSupported: () => true })
  toast.success.mockClear()
  toast.error.mockClear()
})

afterEach(() => vi.unstubAllGlobals())

describe('MakeReplay', () => {
  it("only offers a GIF where video can't be recorded", async () => {
    vi.stubGlobal('MediaRecorder', undefined)
    const make = vi.fn(async () => ({ saved: true as const, where: null }))
    render(<MakeReplay source={src(row(5))} variant="desktop" make={make} />)
    expect(screen.queryByRole('button', { name: /Replay format/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Make replay' }))
    expect(make).toHaveBeenCalledWith(
      expect.objectContaining({ pulls: expect.any(Array) }),
      'gif',
      expect.anything()
    )
  })

  it('names the format the device will really record', () => {
    vi.stubGlobal('MediaRecorder', { isTypeSupported: (m: string) => m.startsWith('video/webm') })
    render(<MakeReplay source={src(row(5))} variant="desktop" make={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Replay format: WEBM' })).toHaveTextContent('WEBM')
  })

  it('is disabled with no pulls', () => {
    render(<MakeReplay source={src(row(0.5), row(null))} variant="desktop" make={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Make replay' })).toBeDisabled()
    expect(screen.getByTitle('No pulls to replay yet')).toBeInTheDocument()
  })

  it('passes the same source to make', async () => {
    const make = vi.fn(async () => ({ saved: true as const, where: null }))
    const source = src(row(5))
    render(<MakeReplay source={source} variant="desktop" make={make} />)
    await userEvent.click(screen.getByRole('button', { name: 'Make replay' }))
    expect(make).toHaveBeenCalledWith(source, 'video', expect.anything())
  })

  it('is disabled when the source has no pulls', () => {
    render(<MakeReplay source={{ pulls: [], header: 'Nov 4' }} variant="desktop" make={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Make replay' })).toBeDisabled()
    expect(screen.getByTitle('No pulls to replay yet')).toBeInTheDocument()
  })

  it('makes a video by default', async () => {
    const make = vi.fn(async () => ({ saved: true as const, where: '/x.mp4' }))
    render(<MakeReplay source={src(row(5))} variant="desktop" make={make} />)
    await userEvent.click(screen.getByRole('button', { name: 'Make replay' }))
    expect(make).toHaveBeenCalledWith(
      expect.objectContaining({ pulls: expect.any(Array) }),
      'video',
      expect.anything()
    )
    expect(toast.success).toHaveBeenCalledWith('Replay saved', { description: '/x.mp4' })
  })

  it('makes a GIF when chosen', async () => {
    const make = vi.fn(async () => ({ saved: true as const, where: null }))
    render(<MakeReplay source={src(row(5))} variant="phone" make={make} />)
    await userEvent.click(screen.getByRole('button', { name: 'Replay format: MP4' }))
    await userEvent.click(screen.getByRole('button', { name: 'Make replay' }))
    expect(make).toHaveBeenCalledWith(
      expect.objectContaining({ pulls: expect.any(Array) }),
      'gif',
      expect.anything()
    )
  })

  it('shows progress', async () => {
    let report: (p: number) => void = () => {}
    const make = vi.fn(
      (_r: unknown, _f: unknown, o: { onProgress: (p: number) => void }) =>
        new Promise<never>(() => {
          report = o.onProgress
        })
    )
    render(<MakeReplay source={src(row(5))} variant="desktop" make={make} />)
    await userEvent.click(screen.getByRole('button', { name: 'Make replay' }))
    act(() => report(0.4))
    expect(screen.getByText('Making replay… 40%')).toBeInTheDocument()
  })

  it('shows an error by its message', async () => {
    const make = vi.fn(async () => {
      throw new Error("Couldn't load the card art")
    })
    render(<MakeReplay source={src(row(5))} variant="desktop" make={make} />)
    await userEvent.click(screen.getByRole('button', { name: 'Make replay' }))
    expect(toast.error).toHaveBeenCalledWith("Couldn't load the card art")
  })

  it('a cancelled save says nothing', async () => {
    const make = vi.fn(async () => ({ saved: false as const }))
    render(<MakeReplay source={src(row(5))} variant="desktop" make={make} />)
    await userEvent.click(screen.getByRole('button', { name: 'Make replay' }))
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('unmounting mid-render aborts quietly', async () => {
    let signal: AbortSignal | null = null
    const make = vi.fn((_r: unknown, _f: unknown, o: { signal: AbortSignal }) => {
      signal = o.signal
      return new Promise<never>((_res, rej) =>
        o.signal.addEventListener('abort', () => rej(new DOMException('', 'AbortError')))
      )
    })
    const { unmount } = render(<MakeReplay source={src(row(5))} variant="desktop" make={make} />)
    await userEvent.click(screen.getByRole('button', { name: 'Make replay' }))
    unmount()
    await act(async () => {})
    expect(signal!.aborted).toBe(true)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('Cancel stops it', async () => {
    let signal: AbortSignal | null = null
    const make = vi.fn((_r: unknown, _f: unknown, o: { signal: AbortSignal }) => {
      signal = o.signal
      return new Promise<never>((_res, rej) =>
        o.signal.addEventListener('abort', () => rej(new DOMException('', 'AbortError')))
      )
    })
    render(<MakeReplay source={src(row(5))} variant="desktop" make={make} />)
    await userEvent.click(screen.getByRole('button', { name: 'Make replay' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(signal!.aborted).toBe(true)
    expect(screen.getByRole('button', { name: 'Make replay' })).toBeEnabled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('Save image saves the same source and says so', async () => {
    const still = vi.fn(async () => ({ saved: true as const, where: '/x.png' }))
    const source = src(row(5))
    render(<MakeReplay source={source} variant="desktop" make={vi.fn()} still={still} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save image' }))
    expect(still).toHaveBeenCalledWith(source)
    expect(toast.success).toHaveBeenCalledWith('Image saved', { description: '/x.png' })
  })

  it('Save image is disabled with no pulls', () => {
    render(
      <MakeReplay
        source={{ pulls: [], header: 'Nov 4' }}
        variant="phone"
        make={vi.fn()}
        still={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Save image' })).toBeDisabled()
  })

  it('shows Saving… and takes no second tap while it runs', async () => {
    let done!: (r: { saved: false }) => void
    const still = vi.fn(() => new Promise<{ saved: false }>((r) => (done = r)))
    render(<MakeReplay source={src(row(5))} variant="desktop" make={vi.fn()} still={still} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save image' }))
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Saving…' }))
    expect(still).toHaveBeenCalledTimes(1)
    await act(async () => done({ saved: false }))
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save image' })).toBeEnabled()
  })

  it('a failed image save says why', async () => {
    const still = vi.fn(async () => {
      throw new Error("Couldn't load the card art")
    })
    render(<MakeReplay source={src(row(5))} variant="desktop" make={vi.fn()} still={still} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save image' }))
    expect(toast.error).toHaveBeenCalledWith("Couldn't load the card art")
  })

  it('Make replay waits while an image saves', async () => {
    let done!: (r: { saved: false }) => void
    const still = vi.fn(() => new Promise<{ saved: false }>((r) => (done = r)))
    render(<MakeReplay source={src(row(5))} variant="phone" make={vi.fn()} still={still} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save image' }))
    expect(screen.getByRole('button', { name: 'Make replay' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Replay format/ })).toBeDisabled()
    await act(async () => done({ saved: false }))
    expect(screen.getByRole('button', { name: 'Make replay' })).toBeEnabled()
  })
})
