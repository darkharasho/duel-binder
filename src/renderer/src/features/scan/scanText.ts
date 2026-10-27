import type { ScanStatus } from '@shared/scanWindow'

export const plural = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`

export function statusText(s: ScanStatus): string {
  switch (s.kind) {
    case 'idle':
      return 'Hold a card up'
    case 'unsure':
      return "Couldn't recognize this card"
    case 'added':
      return `${s.setCode ? `${s.name} ${s.setCode}` : s.name} · added, lower it to scan the next card`
    case 'stopped':
      return 'Scanning stopped after repeated errors.'
  }
}

export const SET_UNREADABLE =
  "Couldn't load this set's cards, so cards are matched against every set."

export const NO_FINGERPRINTS =
  'Artwork matching is unavailable until the artwork data downloads. Set codes and names still work.'
