import { act } from '@testing-library/react'
import { vi } from 'vitest'

/** Makes the filter panel's breakpoint match, so it's the side panel rather than a sheet. */
export function stubWideWindow(): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('min-width'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {}
      }) as unknown as MediaQueryList
  )
}

/** Waits out the search box's debounce. */
export const searchPause = (): Promise<void> =>
  act(() => new Promise<void>((r) => setTimeout(r, 250)))
