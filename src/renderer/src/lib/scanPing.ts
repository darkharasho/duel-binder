/** The optional soft ping when a scanner finds a card; off until asked for, remembered on this device. */
const KEY = 'scan.ping'
const NOTES = [
  { hz: 1046.5, gain: 0.09 },
  { hz: 1568, gain: 0.03 }
]
const ATTACK_S = 0.012
const RING_S = 0.8
/** As near silent as an exponential fade can reach; it can't reach 0. */
const SILENT = 0.0001

let context: AudioContext | null = null

export function scanPingOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setScanPingOn(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    // Unavailable storage only costs the remembered choice.
  }
}

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null
  context ??= new AudioContext()
  return context
}

/** Phones keep audio silent until a tap has started it, so each tap gets it going while it's on. */
function unlock(): void {
  if (!scanPingOn()) return
  const ctx = audio()
  if (ctx?.state !== 'running') void ctx?.resume().catch(() => {})
}

if (typeof document !== 'undefined') document.addEventListener('click', unlock, true)

/** A short, quiet bell, made here rather than from a sound file. Never in the way of a scan. */
export function playScanPing(): void {
  if (!scanPingOn()) return
  try {
    const ctx = audio()
    if (!ctx) return
    if (ctx.state !== 'running') void ctx.resume().catch(() => {})
    const now = ctx.currentTime
    for (const note of NOTES) {
      const tone = ctx.createOscillator()
      const volume = ctx.createGain()
      tone.type = 'sine'
      tone.frequency.value = note.hz
      volume.gain.setValueAtTime(SILENT, now)
      volume.gain.exponentialRampToValueAtTime(note.gain, now + ATTACK_S)
      volume.gain.exponentialRampToValueAtTime(SILENT, now + RING_S)
      tone.connect(volume).connect(ctx.destination)
      tone.start(now)
      tone.stop(now + RING_S)
    }
  } catch {
    // A ping is only decoration.
  }
}
