import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openDatabase } from '../../src/main/db/database'
import type { SqlDb } from '../../src/main/db/sql'
import { listSets } from '../../src/main/repo/sets'

const root = join(__dirname, '../../src')
const files = [
  ...readdirSync(join(root, 'main/repo')).map((f) => join(root, 'main/repo', f)),
  ...['meta', 'schema', 'sql', 'migrateSql'].map((f) => join(root, 'main/db', `${f}.ts`)),
  join(root, 'shared/setImages.ts'),
  ...['client', 'refresh', 'candidates'].map((f) => join(root, 'main/prices', `${f}.ts`)),
  ...['apply', 'upsert'].map((f) => join(root, 'main/catalog', `${f}.ts`)),
  ...['engine', 'client', 'localSync'].map((f) => join(root, 'main/cloud', `${f}.ts`)),
  join(root, 'main/ipc/dataHandlers.ts')
]

describe('SqlDb seam', () => {
  it('better-sqlite3 satisfies SqlDb', () => {
    const db: SqlDb = openDatabase(':memory:')
    expect(listSets(db)).toEqual([])
  })

  it('repo modules import nothing platform-bound', () => {
    for (const file of files) {
      const bad = readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => !/^\s*import type\b/.test(l) && /from '(electron|node:[^']+|better-sqlite3)'/.test(l))
      expect(bad, file).toEqual([])
    }
  })

  it('findSetImageUrl uses positional parameters', () => {
    expect(readFileSync(join(root, 'main/repo/sets.ts'), 'utf8')).not.toMatch(/@key/)
  })
})
