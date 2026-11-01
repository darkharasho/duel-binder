import { describe, expect, it, vi } from 'vitest'
import { MAX_HELD_ERRORS, createMainErrorReports, goneMessage } from '../../src/main/errorReports'

function setup(): {
  reports: ReturnType<typeof createMainErrorReports>
  send: ReturnType<typeof vi.fn>
} {
  const send = vi.fn()
  return { send, reports: createMainErrorReports({ version: () => '1.2.3', send }) }
}

describe('main process error reports', () => {
  it('sends nothing from an early crash when the setting turns out to be off', () => {
    const { reports, send } = setup()
    reports.capture('Main process: early crash', 'at /home/alice/x.js')
    expect(send).not.toHaveBeenCalled()
    reports.setEnabled(false)
    reports.setEnabled(true)
    expect(send).not.toHaveBeenCalled()
  })

  it('treats the setting as off until the renderer says, then sends what it held, scrubbed', () => {
    const { reports, send } = setup()
    reports.capture('boom jane@example.com', 'at /home/alice/x.js')
    expect(send).not.toHaveBeenCalled()
    reports.setEnabled(true)
    expect(send).toHaveBeenCalledExactlyOnceWith({
      appVersion: '1.2.3',
      message: 'boom [email]',
      stack: 'at /home/~/x.js'
    })
  })

  it('holds only a few errors', () => {
    const { reports, send } = setup()
    for (let i = 0; i < MAX_HELD_ERRORS + 3; i++) reports.capture(`e${i}`)
    reports.setEnabled(true)
    expect(send).toHaveBeenCalledTimes(MAX_HELD_ERRORS)
  })

  it('captures nothing while off, and follows the setting when it changes', () => {
    const { reports, send } = setup()
    reports.setEnabled(false)
    reports.capture('off')
    expect(send).not.toHaveBeenCalled()
    reports.setEnabled(true)
    expect(send).not.toHaveBeenCalled()
    reports.capture('on')
    expect(send).toHaveBeenCalledTimes(1)
    reports.setEnabled(false)
    reports.capture('off again')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('dedupes, caps the session, and survives a sender that throws', () => {
    const { reports, send } = setup()
    send.mockImplementation(() => {
      throw new Error('no')
    })
    reports.setEnabled(true)
    expect(() => {
      reports.capture('same')
      reports.capture('same')
      for (let i = 0; i < 20; i++) reports.capture(`e${i}`)
    }).not.toThrow()
    expect(send).toHaveBeenCalledTimes(10)
  })

  it('ignores a process that exited normally', () => {
    expect(goneMessage('Renderer process', { reason: 'clean-exit', exitCode: 0 })).toBeNull()
    expect(goneMessage('Renderer process', { reason: 'crashed', exitCode: 5 })).toBe(
      'Renderer process gone: crashed (exit 5)'
    )
  })
})
