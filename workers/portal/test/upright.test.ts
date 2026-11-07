import { describe, expect, it } from 'vitest'
import { jpegSize, uprightJpeg } from '../../../src/shared/upright'

// A 14×10 JPEG (a card on its side), left half red and right half blue.
const LANDSCAPE = Uint8Array.from(
  atob(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRQBAwQEBQQFCQUFCRQNCw0UFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFP/AABEIAAoADgMBEQACEQEDEQH/xAGiAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgsQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+gEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoLEQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/APmXxD/yANS/69pf/QDXwvAn/JWZT/2E0P8A07E/0h4z/wCSYzP/AK8Vv/TcjxGv9jT/ACmPbvEP/IA1L/r2l/8AQDX+OXAn/JWZT/2E0P8A07E/1Z4z/wCSYzP/AK8Vv/TcjxGv9jT/ACmP/9k='
  ),
  (c) => c.charCodeAt(0)
)

describe('uprightJpeg in the Workers runtime', () => {
  it('re-encodes without Node’s Buffer, which production has no flag for', () => {
    const g = globalThis as { Buffer?: unknown }
    const saved = g.Buffer // the test pool adds nodejs_compat
    delete g.Buffer
    try {
      const out = uprightJpeg(LANDSCAPE)
      expect(out && jpegSize(out)).toEqual({ width: 10, height: 14 })
      expect(g.Buffer).toBeUndefined()
    } finally {
      g.Buffer = saved
    }
  })
})
