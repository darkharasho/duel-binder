import { useEffect, useRef, useState } from 'react'
import {
  CAMERA_RANGES,
  type CameraControlValues,
  type CameraControls,
  type CameraRange
} from '@shared/scanWindow'

// Chromium takes a camera's picture controls (exposure, white balance, brightness...) as track
// constraints from the Image Capture spec, which TypeScript's DOM types leave out.
type Mode = 'manual' | 'continuous' | 'single-shot' | 'none'
type Range = { min?: number; max?: number; step?: number }
type Capabilities = Partial<Record<CameraRange, Range>> & {
  exposureMode?: Mode[]
  whiteBalanceMode?: Mode[]
}
type Settings = Partial<Record<CameraRange, number>> & {
  deviceId?: string
  exposureMode?: Mode
  whiteBalanceMode?: Mode
}
type ControlSet = Partial<Record<CameraRange, number>> & {
  exposureMode?: Mode
  whiteBalanceMode?: Mode
}

const modeOf = (modes: Mode[] | undefined, now: Mode | undefined): boolean | null =>
  modes?.includes('manual') && modes.includes('continuous') ? now !== 'manual' : null

/**
 * The picture controls a camera track offers, from its capabilities and settings; null where it
 * offers none (or won't say, as some browsers don't).
 */
export function readControls(track: MediaStreamTrack): CameraControls | null {
  if (typeof track.getCapabilities !== 'function') return null
  const caps = track.getCapabilities() as Capabilities
  const now = track.getSettings() as Settings
  const ranges: CameraControls['ranges'] = {}
  for (const name of CAMERA_RANGES) {
    const r = caps[name]
    const value = now[name]
    if (r?.min === undefined || r.max === undefined || r.max <= r.min || value === undefined)
      continue
    ranges[name] = { min: r.min, max: r.max, step: r.step || 1, value }
  }
  const autoExposure = modeOf(caps.exposureMode, now.exposureMode)
  const autoWhiteBalance = modeOf(caps.whiteBalanceMode, now.whiteBalanceMode)
  if (!Object.keys(ranges).length && autoExposure === null && autoWhiteBalance === null) return null
  return { deviceId: now.deviceId ?? '', autoExposure, autoWhiteBalance, ranges }
}

/** What a camera is set to now, as values to put it back to. */
export const valuesOf = (c: CameraControls): CameraControlValues => {
  const v: CameraControlValues = {}
  if (c.autoExposure !== null) v.autoExposure = c.autoExposure
  if (c.autoWhiteBalance !== null) v.autoWhiteBalance = c.autoWhiteBalance
  for (const name of CAMERA_RANGES) {
    const r = c.ranges[name]
    if (r) v[name] = r.value
  }
  return v
}

/**
 * The constraint sets that put a camera to `values`, one per control so one the camera refuses
 * doesn't take the others with it, each mode before the value it unlocks. Only controls the
 * camera offers, in its range.
 */
export function controlSets(values: CameraControlValues, offered: CameraControls): ControlSet[] {
  const sets: ControlSet[] = []
  const range = (name: CameraRange): void => {
    const r = offered.ranges[name]
    const v = values[name]
    if (r && v !== undefined) sets.push({ [name]: Math.min(r.max, Math.max(r.min, v)) })
  }
  if (offered.autoExposure !== null && values.autoExposure !== undefined)
    sets.push({ exposureMode: values.autoExposure ? 'continuous' : 'manual' })
  if (values.autoExposure === false || offered.autoExposure === null) range('exposureTime')
  if (offered.autoWhiteBalance !== null && values.autoWhiteBalance !== undefined)
    sets.push({ whiteBalanceMode: values.autoWhiteBalance ? 'continuous' : 'manual' })
  if (values.autoWhiteBalance === false || offered.autoWhiteBalance === null)
    range('colorTemperature')
  for (const name of ['brightness', 'contrast', 'saturation', 'sharpness'] as const) range(name)
  return sets
}

const BASE_KEY = 'scan.cameraBase'

function readBases(): Record<string, CameraControlValues> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(BASE_KEY) ?? '{}')
    return typeof v === 'object' && v !== null ? (v as Record<string, CameraControlValues>) : {}
  } catch {
    return {}
  }
}

/**
 * What the camera was set to the first time it was opened here, before anything was applied:
 * what Reset puts it back to, and what controls not set stay at. The camera keeps what it is set
 * to between apps, so this is the only record of how it was.
 */
export function baseFor(controls: CameraControls): CameraControlValues {
  const bases = readBases()
  const known = bases[controls.deviceId]
  if (known) return known
  const base = valuesOf(controls)
  try {
    localStorage.setItem(BASE_KEY, JSON.stringify({ ...bases, [controls.deviceId]: base }))
  } catch {
    // Unavailable storage: Reset puts it back to how it was when opened this time.
  }
  return base
}

/**
 * Puts the stream's camera to the controls set for it in `byDevice` (over its base, so a control
 * cleared goes back), whenever they change, and gives what the camera offers and is set to.
 */
export function useCameraControls(
  stream: MediaStream | null,
  byDevice: Record<string, CameraControlValues>
): CameraControls | null {
  const track = stream?.getVideoTracks()[0] ?? null
  const [read, setRead] = useState<{ track: MediaStreamTrack; controls: CameraControls } | null>(
    null
  )
  // The camera as it opened (read before anything is applied), and its base.
  const opened = useRef<{
    track: MediaStreamTrack
    offered: CameraControls | null
    base: CameraControlValues
  } | null>(null)
  const deviceId = track?.getSettings().deviceId ?? null
  const wanted = JSON.stringify(deviceId === null ? null : (byDevice[deviceId] ?? {}))

  useEffect(() => {
    if (!track) return
    if (opened.current?.track !== track) {
      const offered = readControls(track)
      opened.current = { track, offered, base: offered ? baseFor(offered) : {} }
    }
    const { offered, base } = opened.current
    if (!offered) return
    let live = true
    const sets = controlSets(
      { ...base, ...(JSON.parse(wanted) as CameraControlValues | null) },
      offered
    )
    const applied = sets.length
      ? track.applyConstraints({ advanced: sets as MediaTrackConstraintSet[] })
      : Promise.resolve()
    applied
      .catch(() => undefined)
      .then(() => {
        const now = live && readControls(track)
        if (now) setRead({ track, controls: now })
      })
    return () => {
      live = false
    }
  }, [track, wanted])

  return read?.track === track ? read.controls : null
}
