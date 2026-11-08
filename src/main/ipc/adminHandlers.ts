import {
  ADMIN_WORKFLOWS,
  type AdminErrorGroup,
  type AdminList,
  type AdminMerge,
  type AdminPhotos,
  type AdminSkippedSignIn,
  type AdminStats,
  type AdminTester,
  type AdminWorkflow
} from '@shared/admin'
import { isGameId } from '@shared/games'
import type { InvokeChannel } from '@shared/ipc'
import type { AdminRuns } from '../adminRuns'
import type { AccountService } from '../cloud/account'

const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0

function name(v: unknown): string {
  if (typeof v !== 'string' || v.trim() === '' || v.length > 64) throw new Error('Bad username')
  return v.trim()
}

function id(v: unknown): number {
  if (!isId(v)) throw new Error('Bad id')
  return v
}

/**
 * The `admin:*` channels: the portal's /admin/* routes as the signed-in account, which the portal
 * answers only for an admin, and GitHub's run list for the Runs tab. Arguments are checked here,
 * so the renderer can only reach these routes with these shapes.
 */
export function adminHandlers(
  account: Pick<AccountService, 'admin'>,
  runs: AdminRuns
): Record<
  Extract<InvokeChannel, `admin:${string}`>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as Handlers types them
  (...args: any[]) => Promise<unknown>
> {
  return {
    'admin:stats': () => account.admin<AdminStats>('/admin/stats'),
    'admin:errors': () => account.admin<AdminErrorGroup[]>('/admin/errors'),
    'admin:runs': async (workflow: unknown, perPage: unknown) => {
      if (!ADMIN_WORKFLOWS.includes(workflow as AdminWorkflow)) throw new Error('Bad workflow')
      const n = typeof perPage === 'number' && Number.isInteger(perPage) ? perPage : 6
      return runs.runs(workflow as AdminWorkflow, Math.min(30, Math.max(1, n)))
    },
    'admin:jobs': async (runId: unknown) => runs.jobs(id(runId)),
    'admin:merges': async () =>
      (await account.admin<{ merges: AdminMerge[] }>('/admin/merges')).merges,
    'admin:undoMerge': async (closedId: unknown) =>
      (
        await account.admin<{ skipped?: AdminSkippedSignIn[] } | undefined>('/admin/merges/undo', {
          closedId: id(closedId)
        })
      )?.skipped ?? [],
    'admin:testers': async () =>
      (await account.admin<{ testers: AdminTester[] }>('/admin/testers')).testers,
    'admin:addTester': async (game: unknown, by: unknown, who: unknown) => {
      if (!isGameId(game)) throw new Error('Bad game')
      if (by !== 'username' && by !== 'discordUsername') throw new Error('Bad tester kind')
      await account.admin('/admin/testers', { game, [by]: name(who) })
    },
    'admin:removeTester': async (testerId: unknown) => {
      await account.admin('/admin/testers/remove', { id: id(testerId) })
    },
    'admin:admins': () => account.admin<AdminList>('/admin/admins'),
    'admin:addAdmin': async (username: unknown) => {
      await account.admin('/admin/admins', { username: name(username) })
    },
    'admin:removeAdmin': async (userId: unknown) => {
      await account.admin('/admin/admins/remove', { userId: id(userId) })
    },
    'admin:photos': () => account.admin<AdminPhotos>('/admin/training')
  }
}
