import { existsSync, renameSync } from 'fs'
import { join } from 'path'

export const USER_DATA_DIR = 'duel-binder'
export const LEGACY_USER_DATA_DIR = 'yugioh-collection-tracker'

/** The data folder under `appData`, moving the pre-rename folder into place the first time. */
export function resolveUserData(appData: string): string {
  const current = join(appData, USER_DATA_DIR)
  const legacy = join(appData, LEGACY_USER_DATA_DIR)
  if (existsSync(current) || !existsSync(legacy)) return current
  try {
    renameSync(legacy, current)
    return current
  } catch {
    return legacy
  }
}
