import '@testing-library/jest-dom/vitest'

// jsdom lacks matchMedia (used by sonner and theme code).
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false
    }) as MediaQueryList
}

// jsdom lacks ResizeObserver and scrollIntoView (used by cmdk).
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe = (): void => undefined
    unobserve = (): void => undefined
    disconnect = (): void => undefined
  } as unknown as typeof ResizeObserver
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}

// jsdom lacks pointer-capture APIs used by Radix Select.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}
