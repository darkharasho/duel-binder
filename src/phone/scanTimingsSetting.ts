const SCAN_TIMINGS_KEY = 'duel-binder:scan-timings'

/** Whether the scanner shows where each frame's time goes (ScanTimingsReadout); this device only. */
export const scanTimingsOn = (): boolean => localStorage.getItem(SCAN_TIMINGS_KEY) === '1'

export const setScanTimingsOn = (on: boolean): void =>
  localStorage.setItem(SCAN_TIMINGS_KEY, on ? '1' : '0')
