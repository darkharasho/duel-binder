import Database from 'better-sqlite3'

test('better-sqlite3 loads under the test runtime', () => {
  const db = new Database(':memory:')
  expect(db.prepare('select 1 as x').get()).toEqual({ x: 1 })
})
