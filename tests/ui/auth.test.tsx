import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginPage, SetupPage } from '@/pages/auth'
import { ConfirmProvider, useConfirm } from '@/components/ui/confirm'
import { useState } from 'react'
import { invoke } from './setup'

describe('first-run setup', () => {
  it('validates locally and does not call the main process when passwords differ', async () => {
    const user = userEvent.setup()
    render(<SetupPage />)
    await user.type(screen.getByLabelText(/your full name/i), 'Ama Mensah')
    await user.type(screen.getByLabelText(/^username/i), 'ama')
    await user.type(screen.getByLabelText(/^password/i), 'Handball2026')
    await user.type(screen.getByLabelText(/confirm/i), 'Different2026')
    await user.click(screen.getByRole('button', { name: /create administrator/i }))
    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument()
    expect(invoke).not.toHaveBeenCalledWith('auth.setup', expect.anything())
  })

  it('submits the administrator account', async () => {
    const user = userEvent.setup()
    render(<SetupPage />)
    await user.type(screen.getByLabelText(/your full name/i), 'Ama Mensah')
    await user.type(screen.getByLabelText(/^username/i), 'ama')
    await user.type(screen.getByLabelText(/^password/i), 'Handball2026')
    await user.type(screen.getByLabelText(/confirm/i), 'Handball2026')
    await user.click(screen.getByRole('button', { name: /create administrator/i }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('auth.setup', expect.objectContaining({ username: 'ama', displayName: 'Ama Mensah', password: 'Handball2026' }))
    )
  })
})

describe('sign in', () => {
  it('shows the error returned by the main process and clears the password', async () => {
    invoke.mockImplementation(async () => ({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Incorrect username or password.' } }))
    const user = userEvent.setup()
    render(<LoginPage />)
    await user.type(screen.getByLabelText(/username/i), 'ama')
    await user.type(screen.getByLabelText(/password/i), 'wrong-pass')
    await user.click(screen.getByRole('button', { name: /sign in/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect username or password.')
    expect(screen.getByLabelText(/password/i)).toHaveValue('')
  })
})

function ConfirmHarness() {
  const confirm = useConfirm()
  const [result, setResult] = useState('pending')
  return (
    <>
      <button onClick={async () => setResult(String(await confirm({ title: 'End first half?', items: ['Clock still running'] })))}>ask</button>
      <span data-testid="result">{result}</span>
    </>
  )
}

describe('critical action protection', () => {
  it('resolves true only when the operator confirms, and lists rule warnings', async () => {
    const user = userEvent.setup()
    render(
      <ConfirmProvider>
        <ConfirmHarness />
      </ConfirmProvider>
    )
    await user.click(screen.getByText('ask'))
    expect(await screen.findByText('Clock still running')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByTestId('result')).toHaveTextContent('false')
    await user.click(screen.getByText('ask'))
    await user.click(await screen.findByRole('button', { name: 'Confirm' }))
    expect(screen.getByTestId('result')).toHaveTextContent('true')
  })
})
