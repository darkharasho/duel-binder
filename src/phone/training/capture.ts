import { MAX_TRAINING_PHOTO_BYTES } from '../../shared/training'

const QUALITIES = [0.92, 0.8, 0.7]

/** The first JPEG quality whose encoding fits the cap; throws when none does. */
export async function encodeWithinCap(
  encode: (quality: number) => Promise<Blob>,
  cap = MAX_TRAINING_PHOTO_BYTES
): Promise<ArrayBuffer> {
  for (const q of QUALITIES) {
    const blob = await encode(q)
    if (blob.size <= cap) return blob.arrayBuffer()
  }
  throw new Error('photo-too-big')
}

/** The whole current video frame as a JPEG, at the camera's full resolution. */
export async function grabFrame(video: HTMLVideoElement): Promise<ArrayBuffer> {
  const w = video.videoWidth
  const h = video.videoHeight
  if (!w) throw new Error('no-frame')
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no-frame')
  ctx.drawImage(video, 0, 0, w, h)
  return encodeWithinCap(
    (q) =>
      new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no-frame'))), 'image/jpeg', q)
      )
  )
}

export function deviceFromUa(ua: string): string {
  if (!ua) return 'unknown'
  const android = /Android ([\d.]+); ([^;)]+)/.exec(ua)
  if (android) {
    const model = android[2].trim()
    return model === 'K' ? `Android ${android[1]}` : `Android ${android[1]} ${model}`
  }
  const ios = /(iPhone|iPad)[^]*?OS (\d+[_\d]*)/.exec(ua)
  if (ios) return `${ios[1]} iOS ${ios[2].replace(/_/g, '.')}`
  return ua.slice(0, 100)
}

interface UaData {
  getHighEntropyValues(hints: string[]): Promise<Record<string, string | undefined>>
}

let memo: Promise<string> | null = null

async function readDeviceModel(): Promise<string> {
  const uaData = (navigator as Navigator & { userAgentData?: UaData }).userAgentData
  if (uaData) {
    try {
      const v = await uaData.getHighEntropyValues(['model', 'platform', 'platformVersion'])
      const s = `${v.platform ?? ''} ${v.platformVersion ?? ''} ${v.model ?? ''}`
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100)
      if (s) return s
    } catch {
      // fall through to the user agent
    }
  }
  return deviceFromUa(navigator.userAgent)
}

export const deviceModel = (): Promise<string> => (memo ??= readDeviceModel())

export const newClientId = (): string => crypto.randomUUID()

export const appVersion = (): string =>
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev'
