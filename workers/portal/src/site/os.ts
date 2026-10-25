export type Os = 'windows' | 'mac' | 'linux'

/** Desktop OS from a User-Agent. Phones, tablets, ChromeOS and unknowns give null. */
export function detectOs(userAgent: string | null): Os | null {
  if (!userAgent) return null
  if (/Android|iPhone|iPad|iPod|CrOS/.test(userAgent)) return null
  if (/Windows/.test(userAgent)) return 'windows'
  // iPadOS sends a Macintosh UA, so iPads get the macOS label; accepted.
  if (/Macintosh|Mac OS X/.test(userAgent)) return 'mac'
  if (/Linux|X11/.test(userAgent)) return 'linux'
  return null
}
