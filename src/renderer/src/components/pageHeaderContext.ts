import { createContext, useContext } from 'react'

/** The big condensed page title: 96 px, 56 px under 1100 px. For a page that draws its own h1. */
export const PAGE_TITLE = 'font-display text-[56px] leading-[.8] min-[1100px]:text-[96px]'

/** True inside a desktop page header while its pinned row is held at the top of the page. */
export const PinnedContext = createContext(false)
export const usePinned = (): boolean => useContext(PinnedContext)
