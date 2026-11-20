// A graded slab's QR code: the link it holds names the grading company and the certification
// number. Read on the device only; nothing is fetched from the grader (their terms bar it).

/** What a slab's QR code says. */
export interface SlabQr {
  company: string
  cert: string
}

/** Grading companies by the domains their QR links point at. */
const HOSTS: [RegExp, string][] = [
  [/(^|\.)tagd\.co$/, 'TAG'],
  [/(^|\.)taggrading\.com$/, 'TAG'],
  [/(^|\.)psacard\.com$/, 'PSA'],
  [/(^|\.)cgccards\.com$/, 'CGC'],
  [/(^|\.)beckett\.com$/, 'BGS'],
  [/(^|\.)gosgc\.com$/, 'SGC'],
  [/(^|\.)agscard\.com$/, 'AGS']
]

/** A cert number: digits, with a leading letter or two on some graders' (TAG's "Y1267951"). */
const CERT = /^[A-Z]{0,2}\d{5,14}$/i

/** Query keys graders put the cert under. */
const CERT_KEYS = ['cert', 'certnumber', 'cert_number', 'certno', 'item_id', 'id']

/**
 * The company and cert a slab QR's text links to, or null when it isn't a grader's link we know
 * or holds no cert. The cert is a query value under a cert key, else the last path segment that
 * looks like one ("tagd.co/Y1267951", "psacard.com/cert/12345678/psa").
 */
export function parseSlabQr(text: string): SlabQr | null {
  let url: URL
  try {
    const t = text.trim()
    url = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  const company = HOSTS.find(([re]) => re.test(host))?.[1]
  if (!company) return null
  for (const [k, v] of url.searchParams)
    if (CERT_KEYS.includes(k.toLowerCase()) && CERT.test(v))
      return { company, cert: v.toUpperCase() }
  const segments = url.pathname.split('/').filter(Boolean)
  const cert = segments.reverse().find((s) => CERT.test(s))
  return cert ? { company, cert: cert.toUpperCase() } : null
}

/** Where each grader shows a cert's public report, for opening in the browser. */
const REPORTS: Partial<Record<string, (cert: string) => string>> = {
  TAG: (c) => `https://tagd.co/${c}`,
  PSA: (c) => `https://www.psacard.com/cert/${c}`,
  CGC: (c) => `https://www.cgccards.com/certlookup/${c}/`
}

/** The grader's public page for a slab's cert, or null for a grader or cert we can't link. */
export function slabReportUrl(company: string, cert: string): string | null {
  const c = cert.trim()
  const report = REPORTS[company]
  return report && CERT.test(c) ? report(encodeURIComponent(c)) : null
}
