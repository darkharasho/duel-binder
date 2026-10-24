const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function formatUsd(n: number | null): string {
  return n === null || !Number.isFinite(n) ? '—' : usd.format(n)
}

export function formatRelative(iso: string | null, now = new Date()): string {
  if (iso === null) return 'never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'never'
  const minutes = Math.floor((now.getTime() - then) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'} ago`
}
