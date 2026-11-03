import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { NewPasswordFields } from '@/features/account/NewPasswordFields'

function Harness({ label }: { label?: string }): React.JSX.Element {
  const [pw, setPw] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  return (
    <NewPasswordFields
      label={label}
      value={pw}
      onChange={setPw}
      confirm={confirm}
      onConfirmChange={setConfirm}
    />
  )
}

describe('NewPasswordFields', () => {
  it('has a password box and a confirm box with placeholders', () => {
    render(<Harness />)
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByPlaceholderText('Password (at least 8 characters)')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute(
      'autocomplete',
      'new-password'
    )
    expect(screen.getByPlaceholderText('Confirm password')).toBeInTheDocument()
  })

  it('names the confirm box after the label', () => {
    render(<Harness label="New password" />)
    expect(screen.getByLabelText('Confirm new password')).toBeInTheDocument()
  })

  it('shows the strength once something is typed', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(screen.queryByText(/Strength/)).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Password'), 'password')
    expect(screen.getByText('Strength: Weak')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Password'))
    await user.type(screen.getByLabelText('Password'), 'Blue-River-Stone-7')
    expect(screen.getByText('Strength: Strong')).toBeInTheDocument()
  })

  it("says the passwords don't match only once the confirmation goes wrong", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(screen.getByLabelText('Password'), 'hunter22!x')
    await user.type(screen.getByLabelText('Confirm password'), 'hunter')
    expect(screen.queryByText("Passwords don't match")).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Confirm password'), 'X')
    expect(screen.getByText("Passwords don't match")).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Confirm password'))
    await user.type(screen.getByLabelText('Confirm password'), 'hunter22!x')
    expect(screen.queryByText("Passwords don't match")).not.toBeInTheDocument()
  })
})
