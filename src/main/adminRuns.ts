/**
 * The admin Runs tab's GitHub reads. The repository is public, so they need no token, and GitHub
 * allows 60 an hour per IP. Each answer is kept with its ETag and asked for again with
 * If-None-Match: GitHub doesn't count an unchanged (304) answer against that limit.
 */
import type { AdminWorkflow, GhJob, GhRun } from '@shared/admin'

const BASE = 'https://api.github.com/repos/darkharasho/duel-binder/actions'
const TIMEOUT_MS = 20_000

export interface AdminRuns {
  runs(workflow: AdminWorkflow, perPage: number): Promise<GhRun[]>
  jobs(runId: number): Promise<GhJob[]>
}

export function createAdminRuns(doFetch: typeof fetch = fetch): AdminRuns {
  const kept = new Map<string, { etag: string; body: unknown }>()

  async function get<T>(path: string): Promise<T> {
    const url = BASE + path
    const had = kept.get(url)
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'user-agent': 'duel-binder-admin'
    }
    if (had) headers['if-none-match'] = had.etag
    const res = await doFetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (res.status === 304 && had) return had.body as T
    if (res.status === 403 || res.status === 429)
      throw new Error('GitHub limit reached for now. It resets within the hour.')
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
    const body = (await res.json()) as T
    const etag = res.headers.get('etag')
    if (etag) kept.set(url, { etag, body })
    return body
  }

  return {
    runs: async (workflow, perPage) =>
      (await get<{ workflow_runs: GhRun[] }>(`/workflows/${workflow}/runs?per_page=${perPage}`))
        .workflow_runs,
    jobs: async (runId) => (await get<{ jobs: GhJob[] }>(`/runs/${runId}/jobs`)).jobs
  }
}
