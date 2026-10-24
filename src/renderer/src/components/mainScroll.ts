import { createContext, useContext } from 'react'

/** Reads and sets the scroll position of the app's `<main>`, for pages that restore it. */
export interface MainScroll {
  get(): number
  set(top: number): void
}

export const MainScrollContext = createContext<MainScroll | null>(null)

export function useMainScroll(): MainScroll | null {
  return useContext(MainScrollContext)
}
