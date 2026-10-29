/**
 * CORI-JP025 -> CORI-JP: the set-code prefix one eBay search covers. Kept in step with `sweepKey` in
 * workers/ebay-prices/src/set.js (tests/portal/sweep.test.ts pins both on the same cases).
 */
export function sweepKey(code: string): string {
  return String(code).replace(/\d+$/, '')
}
