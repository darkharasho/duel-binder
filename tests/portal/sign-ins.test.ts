import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrateServer } from '../../workers/portal/src/migrate'
import { findAccount, refreshLegacyDiscordId, signInWith } from '../../workers/portal/src/signIns'

const NOW = '2026-11-02T12:00:00.000Z'

describe('sign-ins', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrateServer(db)
  })

  interface UserRow {
    discord_id: string
    username: string
    display_name: string | null
    avatar: string | null
    username_chosen: number
    link_hint: number
  }
  const user = (id: number): UserRow =>
    db
      .prepare(
        'SELECT discord_id, username, display_name, avatar, username_chosen, link_hint FROM users WHERE id = ?'
      )
      .get(id) as UserRow

  const discord = (
    subject: string,
    username: string,
    displayName: string | null = null,
    avatar: string | null = null
  ): ReturnType<typeof signInWith> =>
    signInWith(db, { provider: 'discord', subject }, { username, displayName, avatar }, NOW)

  it('a Discord sign-in no longer overwrites a chosen username', () => {
    const { userId, created } = discord('111', 'ann', 'Ann', 'a1')
    expect(created).toBe(true)
    db.prepare("UPDATE users SET username = 'annie', username_chosen = 1 WHERE id = ?").run(userId)
    const again = discord('111', 'ann_new', 'Ann N', 'a2')
    expect(again).toEqual({ userId, created: false })
    expect(user(userId)).toMatchObject({ username: 'annie', display_name: 'Ann N', avatar: 'a2' })
  })

  it('a new Discord account takes its Discord username when valid and free, still unchosen', () => {
    const { userId } = discord('222', 'bob')
    expect(user(userId)).toMatchObject({
      username: 'bob',
      username_chosen: 0,
      link_hint: 1,
      discord_id: '222'
    })
  })

  it('a new Discord account whose name is taken or invalid gets a generated one', () => {
    discord('111', 'ann')
    for (const [subject, name] of [
      ['222', 'ann'],
      ['333', 'a.b']
    ]) {
      const { userId } = discord(subject, name)
      expect(user(userId).username).toMatch(/^duelist-[a-z2-9]{8}$/)
    }
  })

  it('the legacy discord_id follows the sign-ins', () => {
    const { userId } = signInWith(
      db,
      { provider: 'apple', subject: 'abc' },
      { displayName: null, avatar: null },
      NOW
    )
    expect(user(userId).discord_id).toBe('apple:abc')
    db.prepare(
      "INSERT INTO sign_ins (provider, subject, user_id, created_at) VALUES ('discord', '987654321', ?, ?)"
    ).run(userId, NOW)
    refreshLegacyDiscordId(db, userId)
    expect(user(userId).discord_id).toBe('987654321')
    db.prepare('DELETE FROM sign_ins WHERE user_id = ?').run(userId)
    refreshLegacyDiscordId(db, userId)
    expect(user(userId).discord_id).toBe(`user:${userId}`)
  })

  it('findAccount skips closed accounts', () => {
    const { userId } = discord('111', 'ann')
    expect(findAccount(db, { provider: 'discord', subject: '111' })).toBe(userId)
    db.prepare('UPDATE users SET closed_at = ? WHERE id = ?').run(NOW, userId)
    expect(findAccount(db, { provider: 'discord', subject: '111' })).toBeNull()
  })
})
