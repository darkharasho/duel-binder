import { renderHook, waitFor } from '@testing-library/react'
import { useCamera } from '@/features/scan/useCamera'
import { stubCamera } from './scanFakes'

const DESKTOP = {
  audio: false,
  video: { width: { ideal: 3840 }, height: { ideal: 2160 } }
}

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('useCamera', () => {
  it("useCamera with 'environment' asks for the rear camera; without it, constraints are unchanged", async () => {
    const { getUserMedia } = stubCamera()
    const rear = renderHook(() => useCamera(null, 'environment'))
    await waitFor(() => expect(rear.result.current.stream).not.toBeNull())
    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: false,
      video: { ...DESKTOP.video, facingMode: { ideal: 'environment' } }
    })
    rear.unmount()

    const desk = renderHook(() => useCamera(null))
    await waitFor(() => expect(desk.result.current.stream).not.toBeNull())
    expect(getUserMedia).toHaveBeenLastCalledWith(DESKTOP)
    desk.unmount()
  })

  it('a picked camera opens by its id, whichever way it faces', async () => {
    const { getUserMedia } = stubCamera()
    const r = renderHook(() => useCamera('cam1', 'environment'))
    await waitFor(() => expect(r.result.current.stream).not.toBeNull())
    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: false,
      video: { ...DESKTOP.video, deviceId: { exact: 'cam1' } }
    })
    r.unmount()
  })
})
