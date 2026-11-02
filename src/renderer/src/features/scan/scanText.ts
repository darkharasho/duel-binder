import type { FingerprintStatus } from '@shared/scan/types'
import type { ScanStatus } from '@shared/scanWindow'

export const plural = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`

export function statusText(s: ScanStatus): string {
  switch (s.kind) {
    case 'idle':
      return 'Hold a card up'
    case 'unsure':
      return "Couldn't recognize this card. Try a photo."
    case 'reading':
      return 'Reading the photo…'
    case 'photo-failed':
      return "Couldn't read that photo. Hold the card still and try again."
    case 'added':
      return `${s.setCode ? `${s.name} ${s.setCode}` : s.name} · ${s.guess ? 'added as a best guess' : 'added'}, lower it to scan the next card`
    case 'stopped':
      return 'Scanning stopped after repeated errors.'
  }
}

export const SET_UNREADABLE =
  "Couldn't load this set's cards, so cards are matched against every set."

export function artDataText(status: FingerprintStatus | null | undefined): string {
  const still = 'Set codes and names still work.'
  switch (status?.state) {
    case 'downloading':
      return status.progress === undefined
        ? `Downloading artwork data. ${still}`
        : `Downloading artwork data: ${Math.round(status.progress * 100)}%. ${still}`
    case 'error':
      return `Couldn't download the artwork data. Trying again shortly. ${still}`
    case 'missing':
      return `Artwork data for this game isn't available yet. It will load here once it is. ${still}`
    default:
      return `Artwork matching is unavailable until the artwork data downloads. ${still}`
  }
}
