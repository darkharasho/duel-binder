import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { CopyNameButton } from '@/components/CopyNameButton'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CopyNameButton', () => {
  it('copies the card name to the clipboard', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    render(<CopyNameButton name="Dark Magician" />)

    await user.click(screen.getByRole('button', { name: 'Copy name' }))

    expect(writeText).toHaveBeenCalledWith('Dark Magician')
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('says so when the clipboard refuses', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    render(<CopyNameButton name="Dark Magician" />)

    await user.click(screen.getByRole('button', { name: 'Copy name' }))

    expect(toast.error).toHaveBeenCalledWith("Couldn't copy the name")
  })
})
