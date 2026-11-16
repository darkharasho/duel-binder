import {
  ADMIN_WORKFLOWS,
  type AdminBeta,
  type AdminErrorGroup,
  type AdminList,
  type AdminMerge,
  type AdminPhotos,
  type AdminSkippedSignIn,
  type AdminStats,
  type AdminTester,
  type AdminWorkflow,
  type RipFrameInfo
} from '@shared/admin'
import type { AdminCosts } from '@shared/costs'
import { isGameId } from '@shared/games'
import type { InvokeChannel } from '@shared/ipc'
import type { AdminRuns } from '../adminRuns'
import type { AccountService } from '../cloud/account'
import { CloudOfflineError } from '../cloud/client'
import type { RipCapture } from '../ripCapture'

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
  account: Pick<AccountService, 'admin' | 'status'>,
  runs: AdminRuns,
  capture: RipCapture
): Record<
  Extract<InvokeChannel, `admin:${string}`>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as Handlers types them
  (...args: any[]) => Promise<unknown>
> {
  const mustBeAdmin = (): void => {
    if (!account.status().user?.admin) throw new Error('Not found')
  }
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
    'admin:photos': () => account.admin<AdminPhotos>('/admin/training'),
    'admin:costs': async (days: unknown) => {
      if (days !== 7 && days !== 30) throw new Error('Bad days')
      return account.admin<AdminCosts>(`/admin/costs?days=${days}`)
    },
    'admin:beta': () => account.admin<AdminBeta>('/admin/beta'),
    'admin:decideBeta': async (requestId: unknown, status: unknown) => {
      if (status !== 'added' && status !== 'declined') throw new Error('Bad status')
      const body = { id: id(requestId), status }
      try {
        const res = await account.admin<{ emailed: boolean }>('/admin/beta/decide', body)
        return { emailed: res.emailed }
      } catch (e) {
        // The portal answers 502 only when App Store Connect refused an iPhone tester.
        if (e instanceof CloudOfflineError && e.message.includes('(502)'))
          throw new Error(
            "App Store Connect wouldn't add them to the TestFlight group. Try again, or add them in TestFlight yourself."
          )
        throw e
      }
    },
    'admin:deleteBeta': async (requestId: unknown) => {
      await account.admin('/admin/beta/delete', { id: id(requestId) })
    },
    // Rip capture writes on this computer only, but only for a signed-in admin.
    'admin:captureSave': async (session: unknown, file: unknown, jpeg: unknown, info: unknown) => {
      mustBeAdmin()
      return capture.save(
        session as string,
        file as string,
        jpeg as ArrayBuffer,
        (info ?? {}) as RipFrameInfo
      )
    },
    'admin:captureRemove': async (session: unknown, file: unknown) => {
      mustBeAdmin()
      await capture.remove(session as string, file as string)
    },
    'admin:captureNote': async (session: unknown, note: unknown) => {
      mustBeAdmin()
      await capture.note(session as string, note as string)
    },
    'admin:captureOpenFolder': async (session: unknown) => {
      mustBeAdmin()
      await capture.openFolder((session ?? null) as string | null)
    }
  }
}
