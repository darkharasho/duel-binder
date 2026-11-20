import { screen, waitFor } from '@testing-library/react'
import { QrScanDialog } from '@/features/graded/QrScanDialog'
import { renderWithProviders } from './mockApi'

vi.mock('@/features/graded/qrDecode', () => ({ decodeQr: vi.fn(async () => null) }))

describe('the slab QR scanner', () => {
  it('opens the Scan tab’s camera, exactly, and any camera once that one is gone', async () => {
    localStorage.setItem('scan.camera', 'facecam')
    const getUserMedia = vi.fn(async (c: MediaStreamConstraints) => {
      const v = c.video as MediaTrackConstraints
      if (v.deviceId) throw new DOMException('gone', 'OverconstrainedError')
      throw new DOMException('none', 'NotFoundError')
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia }
    })
    renderWithProviders(<QrScanDialog open onClose={() => {}} onRead={() => {}} />)
    expect(await screen.findByText(/No camera to use/)).toBeInTheDocument()
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2))
    const [first, second] = getUserMedia.mock.calls.map((c) => c[0].video as MediaTrackConstraints)
    expect(first.deviceId).toEqual({ exact: 'facecam' })
    expect(first.width).toEqual({ ideal: 3840 })
    expect(second.deviceId).toBeUndefined()
  })
})
