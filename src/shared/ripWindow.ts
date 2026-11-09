import type { CameraResolution } from './scanWindow'

/** Where the key-frame picker is: a card moving, settling, or held still. */
export type RipPickerState = 'moving' | 'settling' | 'held'

/** A kept key frame, as the frame list shows it. */
export interface RipFrame {
  name: string
  /** A small JPEG as a data: URL (the page's CSP blocks blob: images). */
  thumb: string
  sharp: number
  /** When it was kept, ms since the epoch. */
  at: number
  width: number
  height: number
  /** Kept by hand rather than picked. */
  manual: boolean
}

/** What the rip window reports back for the Admin tab to show. */
export interface RipWindowState {
  devices: { deviceId: string; label: string }[]
  openDeviceId: string | null
  resolution: CameraResolution | null
  cameraError: 'denied' | 'none' | 'lost' | 'busy' | null
  /** The session being captured, or null. */
  session: string | null
  picker: RipPickerState
  error: string | null
}

export type ToRipWindow =
  | { kind: 'camera'; deviceId: string | null }
  | { kind: 'retryCamera' }
  /** Starts capturing into this session folder. */
  | { kind: 'start'; session: string }
  | { kind: 'stop' }
  | { kind: 'keep' }
  | { kind: 'remove'; name: string }
  /** Asks for the state and every frame of the session so far. */
  | { kind: 'sync' }

export type FromRipWindow =
  | { kind: 'ready' }
  | { kind: 'state'; state: RipWindowState }
  | { kind: 'frame'; frame: RipFrame }
  | { kind: 'removed'; name: string }
  /** The session's frames, newest first, in answer to `sync`. */
  | { kind: 'frames'; frames: RipFrame[] }

export type RipWindowMessage = ToRipWindow | FromRipWindow

const TO: readonly string[] = ['camera', 'retryCamera', 'start', 'stop', 'keep', 'remove', 'sync']
const FROM: readonly string[] = ['ready', 'state', 'frame', 'removed', 'frames']

const kindOf = (v: unknown): unknown =>
  typeof v === 'object' && v !== null ? (v as { kind?: unknown }).kind : undefined

export const isToRipWindow = (v: unknown): v is ToRipWindow => {
  const k = kindOf(v)
  return typeof k === 'string' && TO.includes(k)
}

export const isFromRipWindow = (v: unknown): v is FromRipWindow => {
  const k = kindOf(v)
  return typeof k === 'string' && FROM.includes(k)
}
