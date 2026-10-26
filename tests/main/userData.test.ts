import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const renameSync = vi.hoisted(() => ({ fail: false }))
vi.mock('fs', async (orig) => {
  const fs = await orig<typeof import('fs')>()
  return {
    ...fs,
    renameSync: (a: string, b: string) => {
      if (renameSync.fail) throw new Error('EBUSY')
      fs.renameSync(a, b)
    }
  }
})

import { resolveUserData } from '../../src/main/userData'

let appData: string
beforeEach(() => {
  appData = mkdtempSync(join(tmpdir(), 'userdata-'))
  renameSync.fail = false
})
afterEach(() => rmSync(appData, { recursive: true, force: true }))

describe('resolveUserData', () => {
  it('uses duel-binder on a fresh install', () => {
    expect(resolveUserData(appData)).toBe(join(appData, 'duel-binder'))
    expect(existsSync(join(appData, 'yugioh-collection-tracker'))).toBe(false)
  })

  it('moves the pre-rename folder over with its contents', () => {
    mkdirSync(join(appData, 'yugioh-collection-tracker'))
    writeFileSync(join(appData, 'yugioh-collection-tracker', 'collection.db'), 'data')
    expect(resolveUserData(appData)).toBe(join(appData, 'duel-binder'))
    expect(readFileSync(join(appData, 'duel-binder', 'collection.db'), 'utf8')).toBe('data')
    expect(existsSync(join(appData, 'yugioh-collection-tracker'))).toBe(false)
  })

  it('leaves both alone once duel-binder exists', () => {
    mkdirSync(join(appData, 'yugioh-collection-tracker'))
    mkdirSync(join(appData, 'duel-binder'))
    expect(resolveUserData(appData)).toBe(join(appData, 'duel-binder'))
    expect(existsSync(join(appData, 'yugioh-collection-tracker'))).toBe(true)
  })

  it('keeps using the old folder when the move fails', () => {
    mkdirSync(join(appData, 'yugioh-collection-tracker'))
    renameSync.fail = true
    expect(resolveUserData(appData)).toBe(join(appData, 'yugioh-collection-tracker'))
  })
})
