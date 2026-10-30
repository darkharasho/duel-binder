import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ArtDataNotice } from '@/features/scan/ArtDataNotice'

describe('ArtDataNotice', () => {
  it('shows how far along the download is', () => {
    render(<ArtDataNotice status={{ state: 'downloading', count: 0, progress: 0.42 }} />)
    expect(screen.getByText(/Downloading artwork data: 42%/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
  })

  it('has no bar when the size is unknown', () => {
    render(<ArtDataNotice status={{ state: 'downloading', count: 0 }} />)
    expect(screen.getByText(/^Downloading artwork data\. /)).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('says when the file is not published yet, and when a download failed', () => {
    const { rerender } = render(<ArtDataNotice status={{ state: 'missing', count: 0 }} />)
    expect(screen.getByText(/isn't available yet/)).toBeInTheDocument()
    rerender(<ArtDataNotice status={{ state: 'error', count: 0 }} />)
    expect(screen.getByText(/Trying again shortly/)).toBeInTheDocument()
  })
})
