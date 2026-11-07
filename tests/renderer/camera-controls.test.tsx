import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import type { CameraControls } from '@shared/scanWindow'
import {
  baseFor,
  controlSets,
  readControls,
  useCameraControls
} from '@/features/scan/cameraControls'
import { CameraControlsPanel, shutterText } from '@/features/scan/CameraControlsPanel'

afterEach(() => localStorage.clear())

/** A Facecam-like track: what it offers, and settings that change as constraints are applied. */
function fakeTrack(deviceId = 'cam1'): {
  track: MediaStreamTrack
  settings: Record<string, unknown>
  applied: unknown[]
} {
  const settings: Record<string, unknown> = {
    deviceId,
    exposureMode: 'continuous',
    exposureTime: 333,
    whiteBalanceMode: 'manual',
    colorTemperature: 4500,
    brightness: 4,
    contrast: 116,
    sharpness: 116
  }
  const applied: unknown[] = []
  const track = {
    getCapabilities: () => ({
      exposureMode: ['manual', 'continuous'],
      whiteBalanceMode: ['manual', 'continuous'],
      exposureTime: { min: 1, max: 1000, step: 1 },
      colorTemperature: { min: 2400, max: 10000, step: 100 },
      brightness: { min: -9, max: 9, step: 1 },
      contrast: { min: 0, max: 200, step: 1 },
      sharpness: { min: 0, max: 200, step: 1 },
      // Offered with no setting: left out.
      saturation: { min: 0, max: 200, step: 1 }
    }),
    getSettings: () => ({ ...settings }),
    applyConstraints: vi.fn(async (c: { advanced: Record<string, unknown>[] }) => {
      applied.push(c)
      for (const set of c.advanced) Object.assign(settings, set)
    })
  } as unknown as MediaStreamTrack
  return { track, settings, applied }
}

const streamOf = (track: MediaStreamTrack): MediaStream =>
  ({ getVideoTracks: () => [track] }) as unknown as MediaStream

describe('readControls', () => {
  it('gives the controls the camera offers and has a setting for, and whether each mode is auto', () => {
    const c = readControls(fakeTrack().track)!
    expect(c.deviceId).toBe('cam1')
    expect(c.autoExposure).toBe(true)
    expect(c.autoWhiteBalance).toBe(false)
    expect(c.ranges.exposureTime).toEqual({ min: 1, max: 1000, step: 1, value: 333 })
    expect(c.ranges.saturation).toBeUndefined()
  })

  it('is null where the browser says nothing', () => {
    expect(readControls({ getSettings: () => ({}) } as unknown as MediaStreamTrack)).toBeNull()
  })
})

describe('controlSets', () => {
  const offered = readControls(fakeTrack().track) as CameraControls

  it('puts each mode before the value it unlocks, one control a set, clamped to range', () => {
    expect(
      controlSets({ autoExposure: false, exposureTime: 5000, brightness: -20 }, offered)
    ).toEqual([{ exposureMode: 'manual' }, { exposureTime: 1000 }, { brightness: -9 }])
  })

  it('leaves a time out while its mode is auto, and anything the camera lacks', () => {
    expect(controlSets({ autoExposure: true, exposureTime: 80, saturation: 50 }, offered)).toEqual([
      { exposureMode: 'continuous' }
    ])
  })
})

it('baseFor keeps the first reading of each camera', () => {
  const offered = readControls(fakeTrack().track)!
  expect(baseFor(offered)).toMatchObject({ autoExposure: true, brightness: 4 })
  expect(baseFor({ ...offered, ranges: {} })).toMatchObject({ brightness: 4 })
})

it('shutterText', () => {
  expect(shutterText(80)).toBe('1/125 s')
  expect(shutterText(333)).toBe('1/30 s')
  expect(shutterText(2500)).toBe('0.3 s')
})

describe('useCameraControls', () => {
  it('applies what is set for the camera, and puts it back to how it opened when cleared', async () => {
    const { track, settings } = fakeTrack()
    const stream = streamOf(track)
    const r = renderHook(({ values }) => useCameraControls(stream, values), {
      initialProps: { values: {} as Record<string, object> }
    })
    await waitFor(() => expect(r.result.current?.ranges.brightness?.value).toBe(4))

    r.rerender({ values: { cam1: { autoExposure: false, exposureTime: 80, brightness: 0 } } })
    await waitFor(() => expect(r.result.current?.autoExposure).toBe(false))
    expect(settings).toMatchObject({ exposureMode: 'manual', exposureTime: 80, brightness: 0 })

    r.rerender({ values: {} })
    await waitFor(() => expect(r.result.current?.autoExposure).toBe(true))
    expect(settings).toMatchObject({ exposureMode: 'continuous', brightness: 4 })
  })

  it("leaves another camera's controls alone", async () => {
    const { track, settings } = fakeTrack('cam2')
    const r = renderHook(() => useCameraControls(streamOf(track), { cam1: { brightness: 0 } }))
    await waitFor(() => expect(r.result.current).not.toBeNull())
    expect(settings.brightness).toBe(4)
  })

  it('is null with no stream', () => {
    expect(renderHook(() => useCameraControls(null, {})).result.current).toBeNull()
  })
})

describe('CameraControlsPanel', () => {
  const controls = readControls(fakeTrack().track)!

  it('changes a control, turns auto exposure off, and resets', () => {
    const onChange = vi.fn()
    render(<CameraControlsPanel controls={controls} values={{}} onChange={onChange} />)
    // Auto exposure: the time slider waits until it's off.
    expect(screen.getByRole('slider', { name: 'Exposure time' })).toBeDisabled()
    fireEvent.change(screen.getByRole('slider', { name: 'Brightness' }), {
      target: { value: '1' }
    })
    expect(onChange).toHaveBeenLastCalledWith({ brightness: 1 })
    act(() => screen.getByRole('checkbox', { name: 'Auto exposure' }).click())
    expect(onChange).toHaveBeenLastCalledWith({ autoExposure: false })
    act(() => screen.getByRole('button', { name: 'Reset' }).click())
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('shows the shutter speed set, on a slider that moves in steps the camera takes', () => {
    const onChange = vi.fn()
    render(
      <CameraControlsPanel
        controls={controls}
        values={{ autoExposure: false, exposureTime: 80 }}
        onChange={onChange}
      />
    )
    expect(screen.getByText('1/125 s')).toBeInTheDocument()
    const slider = screen.getByRole('slider', { name: 'Exposure time' })
    fireEvent.change(slider, { target: { value: '0' } })
    expect(onChange).toHaveBeenLastCalledWith({ autoExposure: false, exposureTime: 1 })
    fireEvent.change(slider, { target: { value: '200' } })
    expect(onChange).toHaveBeenLastCalledWith({ autoExposure: false, exposureTime: 1000 })
  })
})
