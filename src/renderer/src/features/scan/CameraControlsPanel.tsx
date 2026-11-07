import type {
  CameraControlRange,
  CameraControlValues,
  CameraControls,
  CameraRange
} from '@shared/scanWindow'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'

/** exposureTime is in 100 microsecond units: "1/120 s", or "0.3 s" past a tenth of a second. */
// eslint-disable-next-line react-refresh/only-export-components -- a pure helper, tested on its own
export function shutterText(exposureTime: number): string {
  const seconds = exposureTime / 10000
  return seconds >= 0.1 ? `${seconds.toFixed(1)} s` : `1/${Math.round(1 / seconds)} s`
}

/** Steps of the exposure slider, spread evenly over the log of the time (short times matter). */
const SHUTTER_STEPS = 200

/**
 * The open camera's picture controls: auto or manual exposure and white balance, and its
 * brightness, contrast, saturation and sharpness. `values` are the ones set for this camera
 * (saved, per camera); onChange gives them changed, or null to put the camera back as it was.
 */
export function CameraControlsPanel({
  controls,
  values,
  onChange
}: {
  controls: CameraControls
  values: CameraControlValues
  onChange: (values: CameraControlValues | null) => void
}): React.JSX.Element {
  const set = (patch: CameraControlValues): void => onChange({ ...values, ...patch })
  const autoExposure = values.autoExposure ?? controls.autoExposure
  const autoWhiteBalance = values.autoWhiteBalance ?? controls.autoWhiteBalance
  const valueOf = (name: CameraRange, r: CameraControlRange): number => values[name] ?? r.value
  const { exposureTime, colorTemperature } = controls.ranges

  return (
    <section
      aria-label="Camera settings"
      className="mt-3 grid max-w-3xl grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 rounded-lg border p-4 text-sm"
    >
      {(exposureTime || autoExposure !== null) && (
        <>
          <span>Exposure</span>
          <div className="flex items-center gap-3">
            {autoExposure !== null && (
              <AutoBox
                label="Auto exposure"
                checked={autoExposure}
                onChange={(on) => set({ autoExposure: on })}
              />
            )}
            {exposureTime && (
              <ShutterSlider
                range={exposureTime}
                value={valueOf('exposureTime', exposureTime)}
                disabled={autoExposure === true}
                onChange={(v) => set({ exposureTime: v })}
              />
            )}
          </div>
          <span className="w-20 text-right text-muted-foreground tabular-nums">
            {exposureTime && autoExposure !== true
              ? shutterText(valueOf('exposureTime', exposureTime))
              : 'Auto'}
          </span>
        </>
      )}
      {(colorTemperature || autoWhiteBalance !== null) && (
        <>
          <span>White balance</span>
          <div className="flex items-center gap-3">
            {autoWhiteBalance !== null && (
              <AutoBox
                label="Auto white balance"
                checked={autoWhiteBalance}
                onChange={(on) => set({ autoWhiteBalance: on })}
              />
            )}
            {colorTemperature && (
              <RangeSlider
                label="Colour temperature"
                range={colorTemperature}
                value={valueOf('colorTemperature', colorTemperature)}
                disabled={autoWhiteBalance === true}
                onChange={(v) => set({ colorTemperature: v })}
              />
            )}
          </div>
          <span className="w-20 text-right text-muted-foreground tabular-nums">
            {colorTemperature && autoWhiteBalance !== true
              ? `${valueOf('colorTemperature', colorTemperature)} K`
              : 'Auto'}
          </span>
        </>
      )}
      {(
        [
          ['brightness', 'Brightness'],
          ['contrast', 'Contrast'],
          ['saturation', 'Saturation'],
          ['sharpness', 'Sharpness']
        ] as const
      ).map(([name, label]) => {
        const r = controls.ranges[name]
        if (!r) return null
        return (
          <Row key={name} label={label} value={valueOf(name, r)}>
            <RangeSlider
              label={label}
              range={r}
              value={valueOf(name, r)}
              onChange={(v) => set({ [name]: v })}
            />
          </Row>
        )
      })}
      <p className="col-span-2 text-xs text-muted-foreground">
        Saved for this camera. A shorter exposure blurs a moving card less, but darkens the picture.
      </p>
      <Button variant="outline" size="xs" onClick={() => onChange(null)}>
        Reset
      </Button>
    </section>
  )
}

function Row({
  label,
  value,
  children
}: {
  label: string
  value: number
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <>
      <span>{label}</span>
      {children}
      <span className="w-20 text-right text-muted-foreground tabular-nums">{value}</span>
    </>
  )
}

function AutoBox({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (on: boolean) => void
}): React.JSX.Element {
  return (
    <label className="flex shrink-0 items-center gap-1.5">
      <Checkbox
        aria-label={label}
        checked={checked}
        onCheckedChange={(c) => onChange(c === true)}
      />
      Auto
    </label>
  )
}

function RangeSlider({
  label,
  range,
  value,
  disabled,
  onChange
}: {
  label: string
  range: CameraControlRange
  value: number
  disabled?: boolean
  onChange: (v: number) => void
}): React.JSX.Element {
  return (
    <input
      type="range"
      aria-label={label}
      min={range.min}
      max={range.max}
      step={range.step}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full min-w-40 accent-primary disabled:opacity-40"
    />
  )
}

/** Exposure time on a log scale, snapped to the camera's step. */
function ShutterSlider({
  range,
  value,
  disabled,
  onChange
}: {
  range: CameraControlRange
  value: number
  disabled?: boolean
  onChange: (v: number) => void
}): React.JSX.Element {
  const lo = Math.log(Math.max(range.min, 1))
  const hi = Math.log(range.max)
  const toPos = (v: number): number =>
    Math.round(((Math.log(Math.max(v, 1)) - lo) / (hi - lo)) * SHUTTER_STEPS)
  const toValue = (pos: number): number => {
    const v = Math.exp(lo + (pos / SHUTTER_STEPS) * (hi - lo))
    const snapped = range.min + Math.round((v - range.min) / range.step) * range.step
    return Math.min(range.max, Math.max(range.min, snapped))
  }
  return (
    <input
      type="range"
      aria-label="Exposure time"
      min={0}
      max={SHUTTER_STEPS}
      step={1}
      value={toPos(value)}
      disabled={disabled}
      onChange={(e) => onChange(toValue(Number(e.target.value)))}
      className="w-full min-w-40 accent-primary disabled:opacity-40"
    />
  )
}
