import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { captureShots, SHOTS } from '../../src/main/dev/capture'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function fakeWin(found: (script: string) => boolean = () => true) {
  const scripts: string[] = []
  const win = {
    webContents: {
      executeJavaScript: async (script: string) => {
        scripts.push(script)
        return script.includes('.click()') ? found(script) : true
      },
      debugger: {
        isAttached: () => true,
        sendCommand: async () => ({ data: Buffer.from('png').toString('base64') })
      }
    }
  }
  return { win: win as never, scripts }
}

describe('captureShots', () => {
  it('clicks in order, waits for images, and writes the PNG', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cap-'))
    dirs.push(dir)
    const { win, scripts } = fakeWin()
    const out = await captureShots(win, dir, [{ file: 'a.png', clicks: ['Sets', 'LOB'] }])
    expect(out).toEqual([join(dir, 'a.png')])
    expect(readFileSync(join(dir, 'a.png')).toString()).toBe('png')
    const clicks = scripts.filter((s) => s.includes('.click()'))
    expect(clicks).toHaveLength(2)
    expect(clicks[0]).toContain(JSON.stringify('Sets'))
    expect(clicks[1]).toContain(JSON.stringify('LOB'))
    expect(scripts.some((s) => s.includes('complete'))).toBe(true)
  })

  it('rejects naming a label that matches no button', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cap-'))
    dirs.push(dir)
    const { win } = fakeWin(() => false)
    await expect(captureShots(win, dir, [{ file: 'a.png', clicks: ['Nope'] }])).rejects.toThrow(
      /Nope/
    )
  })

  it('defines the site shots of each game', () => {
    expect(SHOTS.ygo.map((s) => s.file)).toEqual(['collection.png', 'dashboard.png'])
    expect(SHOTS.pkm.map((s) => s.file)).toEqual(['collection-pokemon.png', 'sets.png'])
  })
})
