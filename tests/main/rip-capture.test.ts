import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRipCapture } from '../../src/main/ripCapture'

const dirs: string[] = []
function make() {
  const dir = mkdtempSync(join(tmpdir(), 'rip-'))
  dirs.push(dir)
  const openPath = vi.fn(async () => '')
  return { dir, openPath, cap: createRipCapture(dir, openPath) }
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]).buffer
const info = { sharp: 12.6, width: 1920, height: 1080 }

describe('rip capture on disk', () => {
  it('saves a frame and logs it, then removes it', async () => {
    const { dir, cap } = make()
    const path = await cap.save('20261109-081500', 'k00001.jpg', jpeg, info)
    expect(path).toBe(join(dir, '20261109-081500', 'k00001.jpg'))
    expect([...readFileSync(path)]).toEqual([0xff, 0xd8, 1, 2, 0xff, 0xd9])
    const log = readFileSync(join(dir, '20261109-081500', 'keyframes.jsonl'), 'utf8')
    expect(JSON.parse(log)).toMatchObject({ file: 'k00001.jpg', sharp: 13, width: 1920 })
    await cap.remove('20261109-081500', 'k00001.jpg')
    expect(existsSync(path)).toBe(false)
  })

  it('only writes k#####.jpg in a session folder', async () => {
    const { cap } = make()
    await expect(cap.save('../x', 'k00001.jpg', jpeg, info)).rejects.toThrow('Bad session')
    await expect(cap.save('20261109-081500', '../../a.jpg', jpeg, info)).rejects.toThrow(
      'Bad frame name'
    )
    await expect(
      cap.save('20261109-081500', 'k00001.jpg', new ArrayBuffer(0), info)
    ).rejects.toThrow('Bad frame')
    await expect(cap.remove('20261109-081500', 'keyframes.jsonl')).rejects.toThrow()
  })

  it('keeps a note beside the frames, and clears it', async () => {
    const { dir, cap } = make()
    const path = join(dir, '20261109-081500', 'note.txt')
    await cap.note('20261109-081500', '  Foundations play boosters, good data  ')
    expect(readFileSync(path, 'utf8')).toBe('Foundations play boosters, good data\n')
    await cap.note('20261109-081500', '')
    expect(existsSync(path)).toBe(false)
    await expect(cap.note('../x', 'hi')).rejects.toThrow('Bad session')
  })

  it('opens the session or capture folder', async () => {
    const { dir, cap, openPath } = make()
    await cap.openFolder(null)
    expect(openPath).toHaveBeenLastCalledWith(dir)
    await cap.openFolder('20261109-081500')
    expect(openPath).toHaveBeenLastCalledWith(join(dir, '20261109-081500'))
    await expect(cap.openFolder('nope')).rejects.toThrow('Bad session')
  })
})
