import {
  ADMIN_WORKFLOWS,
  type AdminBeta,
  type AdminErrorGroup,
  type AdminList,
  type AdminSeats,
  type AdminMerge,
  type AdminPhotos,
  type AdminSkippedSignIn,
  type AdminStats,
  type AdminTerm,
  type AdminTermFields,
  type AdminTester,
  type AdminWorkflow,
  type RipFrameInfo
} from '@shared/admin'
import type { AdminSupporters } from '@shared/admin'
import type { AdminCosts } from '@shared/costs'
import { isGameId } from '@shared/games'
import type { InvokeChannel } from '@shared/ipc'
import { MAX_TERM_WORDS, termWords } from '@shared/search/terms'
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

const TERM_STATUSES: readonly string[] = ['pending', 'approved', 'rejected']
const TERM_KINDS: readonly string[] = ['nickname', 'abbreviation', 'subset', 'rarity', 'cards']
const TERM_TARGET_KINDS: readonly string[] = ['printing', 'card', 'set', 'rarity', 'cards']

/** An edited or new term's fields, shaped as the portal reads them (it checks the values). */
function termFields(v: unknown): AdminTermFields {
  const o = v as Partial<AdminTermFields> | null
  if (
    !o ||
    typeof o !== 'object' ||
    typeof o.phrase !== 'string' ||
    o.phrase.trim() === '' ||
    o.phrase.length > 80 ||
    termWords(o.phrase).length > MAX_TERM_WORDS ||
    !TERM_KINDS.includes(o.kind as string) ||
    !TERM_TARGET_KINDS.includes(o.targetKind as string) ||
    !o.target ||
    typeof o.target !== 'object'
  )
    throw new Error('Bad term')
  return { phrase: o.phrase.trim(), kind: o.kind!, targetKind: o.targetKind!, target: o.target }
}

/** The portal's 409 and 400 on a term, as a sentence for the page. */
/** The 409 text: which list already has the phrase, when the portal says. */
export function duplicateText(status: string | undefined): string {
  if (status === 'rejected')
    return 'That phrase is already used by a rejected term in this game. Restore it from the Rejected list.'
  if (status === 'pending')
    return 'That phrase is already used by a pending term in this game. Approve or edit it there.'
  if (status === 'approved') return 'That phrase is already used by an approved term in this game.'
  return 'That phrase is already used by another term in this game.'
}

/** The seats actions that act on one waitlist entry by id. */
const SEAT_ENTRY_ACTIONS = ['invite', 'resend', 'cancel', 'delete']

async function termWrite(call: () => Promise<unknown>): Promise<void> {
  try {
    await call()
  } catch (e) {
    const message = e instanceof Error ? e.message : ''
    const dup = /^duplicate(?:-(pending|approved|rejected))?$/.exec(message)
    if (dup) throw new Error(duplicateText(dup[1]), { cause: e })
    if (message === 'Bad request')
      throw new Error(
        'The portal refused those values. Check the phrase (up to 4 words), the kind, and the list its target kind uses (card ids for card or cards, printing keys, sets or rarities).',
        { cause: e }
      )
    throw e
  }
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
    'admin:supporters': () => account.admin<AdminSupporters>('/admin/supporters'),
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
            "App Store Connect wouldn't add them to the TestFlight group. Try again, or add them in TestFlight yourself.",
            { cause: e }
          )
        throw e
      }
    },
    'admin:deleteBeta': async (requestId: unknown) => {
      await account.admin('/admin/beta/delete', { id: id(requestId) })
    },
    'admin:seats': () => account.admin<AdminSeats>('/admin/seats'),
    'admin:seatsAction': async (req: unknown) => {
      const { action, id: entryId, cap } = (req ?? {}) as Record<string, unknown>
      let body: Record<string, number> = {}
      if (action === 'cap') {
        if (typeof cap !== 'number' || !Number.isInteger(cap) || cap < 0 || cap > 100_000)
          throw new Error('Bad cap')
        body = { cap }
      } else if (action !== 'fill') {
        if (!SEAT_ENTRY_ACTIONS.includes(action as string)) throw new Error('Bad action')
        body = { id: id(entryId) }
      }
      try {
        const res = await account.admin<{ invited?: number } | undefined>(
          `/admin/seats/${action as string}`,
          body
        )
        return typeof res?.invited === 'number' ? { invited: res.invited } : {}
      } catch (e) {
        // invite and resend: the portal's 409 reaches here as Error('joined'), an entry that already has an account, 502 an email that failed.
        if (e instanceof Error && e.message === 'joined')
          throw new Error('That person already has an account.', { cause: e })
        if (e instanceof CloudOfflineError && e.message.includes('(502)'))
          throw new Error("The invite email didn't go out. Try again.", { cause: e })
        throw e
      }
    },
    'admin:terms': async (game: unknown, status: unknown) => {
      if (!isGameId(game)) throw new Error('Bad game')
      if (!TERM_STATUSES.includes(status as string)) throw new Error('Bad status')
      return (
        await account.admin<{ terms: AdminTerm[] }>(`/admin/terms?status=${status}&game=${game}`)
      ).terms
    },
    'admin:decideTerm': async (termId: unknown, status: unknown, edit?: unknown) => {
      if (status !== 'approved' && status !== 'rejected') throw new Error('Bad status')
      const body = { id: id(termId), status, ...(edit == null ? {} : termFields(edit)) }
      await termWrite(() => account.admin('/admin/terms/decide', body))
    },
    'admin:addTerm': async (game: unknown, term: unknown) => {
      if (!isGameId(game)) throw new Error('Bad game')
      const body = { game, ...termFields(term) }
      await termWrite(() => account.admin('/admin/terms/add', body))
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
