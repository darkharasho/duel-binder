import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudAuthError } from '../../src/main/cloud/client'
import type { PhoneStore } from '../../src/phone/data/store'
import { connectStore, exposeStore, type MessagePortLike } from '../../src/phone/data/protocol'

const ports: MessagePort[] = []
afterEach(() => {
  for (const p of ports.splice(0)) p.close()
})

/** A fake store on one end of a MessageChannel and its client on the other. */
function pair(fake: Partial<PhoneStore>): PhoneStore {
  const { port1, port2 } = new MessageChannel()
  ports.push(port1, port2)
  exposeStore(fake as PhoneStore, port1 as unknown as MessagePortLike)
  return connectStore(port2 as unknown as MessagePortLike)
}

describe('phone store protocol', () => {
  it('values round-trip', async () => {
    const invoke = vi.fn(async (channel: string, args: unknown[]) => ({ channel, args }))
    const client = pair({ invoke: invoke as PhoneStore['invoke'] })
    await expect(client.invoke('cards:search', ['magician'])).resolves.toEqual({
      channel: 'cards:search',
      args: ['magician']
    })
    expect(invoke).toHaveBeenCalledWith('cards:search', ['magician'])
  })

  it('an ArrayBuffer value arrives whole and is moved, not copied', async () => {
    const buffer = new Uint8Array([1, 2, 3]).buffer
    const client = pair({ fingerprints: async () => buffer })
    const got = await client.fingerprints('ygo')
    expect([...new Uint8Array(got!)]).toEqual([1, 2, 3])
    expect(buffer.byteLength).toBe(0)
  })

  it("CloudAuthError's name survives", async () => {
    const client = pair({
      sync: async () => {
        throw new CloudAuthError('Signed out by the server')
      }
    })
    const err = await client.sync().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CloudAuthError)
    expect(err).toMatchObject({ name: 'CloudAuthError', message: 'Signed out by the server' })
  })

  it('a plain error keeps its name and message', async () => {
    const client = pair({
      invoke: async () => {
        const e = new Error('Bad notes')
        e.name = 'RangeError'
        throw e
      }
    })
    await expect(client.invoke('collection:add', [{}])).rejects.toMatchObject({
      name: 'RangeError',
      message: 'Bad notes'
    })
  })

  it('progress callbacks arrive in order', async () => {
    const client = pair({
      fillCatalog: async (onProgress) => {
        for (let cursor = 1; cursor <= 3; cursor++) onProgress({ cursor, latest: 3 })
      }
    })
    const seen: number[] = []
    await client.fillCatalog((p) => seen.push(p.cursor))
    expect(seen).toEqual([1, 2, 3])
  })

  it('a fatal message from the worker rejects calls', async () => {
    const { port1, port2 } = new MessageChannel()
    ports.push(port1, port2)
    const client = connectStore(port2 as unknown as MessagePortLike)
    const pending = client.catalog()
    port1.postMessage({ fatal: 'OPFS is not available' })
    await expect(pending).rejects.toThrow('OPFS is not available')
    await expect(client.account()).rejects.toThrow('OPFS is not available')
  })
})
