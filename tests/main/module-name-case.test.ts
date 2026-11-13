import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// macOS and Windows file systems ignore case, so `./Foo` can load `foo.ts` instead of
// `Foo.tsx` there while Linux CI picks the right file. iOS, Mac and Windows builds broke this way.
describe('module names', () => {
  it('no two source files in one folder differ only by case', () => {
    const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
    const stem = (f: string): string => f.replace(/\.(d\.ts|tsx?|jsx?|mjs|cjs)$/, '')
    const seen = new Map<string, string>()
    const clashes: string[] = []
    for (const file of files) {
      const key = stem(file).toLowerCase()
      const prev = seen.get(key)
      if (prev === undefined) seen.set(key, file)
      else if (stem(prev) !== stem(file)) clashes.push(`${prev} / ${file}`)
    }
    expect(clashes).toEqual([])
  })
})
