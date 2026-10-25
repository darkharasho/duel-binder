import { createContext, useContext, useEffect } from 'react'

/** Sets the image (a `ygo-img://` URL) whose blurred colours tint the top of the app; null for none. */
export const ArtWashContext = createContext<((src: string | null) => void) | null>(null)

/** Tints the app with `src` while the calling page is shown; `undefined` leaves it to a child view. */
export function useArtWash(src: string | null | undefined): void {
  const set = useContext(ArtWashContext)
  useEffect(() => {
    if (src === undefined) return
    set?.(src)
    return () => set?.(null)
  }, [set, src])
}

export const cardArtUrl = (imageId: number): string => `ygo-img://small/${imageId}`
export const coverArtUrl = (imageId: number): string => `ygo-img://cropped/${imageId}`
export const setArtUrl = (imageKey: string): string => `ygo-img://set/${imageKey}`
