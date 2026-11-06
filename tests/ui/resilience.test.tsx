import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScreenError } from '@/components/layout/screen-error'
import { NAV } from '@/lib/nav'
import { HelpPage } from '@/pages/help'
import { reportError } from '@/lib/report-error'
import { invoke } from './setup'

function Broken(): never {
  throw new Error('The screen broke')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a screen that fails', () => {
  const failingScreen = () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const router = createMemoryRouter([{ path: '/', element: <Broken />, errorElement: <ScreenError /> }])
    render(<RouterProvider router={router} />)
  }

  it('explains that saved work is safe and offers a way back, instead of a blank window', () => {
    failingScreen()
    expect(screen.getByRole('alert')).toHaveTextContent('Everything already saved is safe')
    expect(screen.getByRole('button', { name: 'Reload this screen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to the dashboard' })).toBeInTheDocument()
  })

  it('offers no way into the operator screens from a public screen', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<RouterProvider router={createMemoryRouter([{ path: '/', element: <Broken />, errorElement: <ScreenError publicScreen /> }])} />)
    expect(screen.getByRole('button', { name: 'Reload this screen' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Go to the dashboard' })).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).not.toHaveTextContent('Settings')
  })

  it('sends the error to the log', () => {
    failingScreen()
    expect(invoke).toHaveBeenCalledWith('app.reportError', expect.objectContaining({ message: 'The screen broke' }))
  })
})

describe('reporting an error', () => {
  it('stays within the limits the main process accepts', () => {
    const huge = new Error('m'.repeat(5000))
    huge.stack = 's'.repeat(20_000)
    reportError(huge)
    const [, input] = invoke.mock.calls[0] as [string, { message: string; stack: string }]
    expect(input.message).toHaveLength(2000)
    expect(input.stack).toHaveLength(8000)
  })

  it('accepts something that is not an Error', () => {
    reportError('plain text')
    expect(invoke).toHaveBeenCalledWith('app.reportError', expect.objectContaining({ message: 'plain text', stack: expect.any(String) }))
  })

  it('never fails the caller when the log cannot be reached', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    invoke.mockRejectedValueOnce(new Error('main process gone'))
    expect(() => reportError(new Error('x'))).not.toThrow()
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled())
  })
})

describe('the guides', () => {
  it('opens on the user guide and renders tables', () => {
    render(<HelpPage />)
    expect(screen.getByRole('heading', { name: 'User guide', level: 1 })).toBeInTheDocument()
    expect(screen.getAllByRole('table').length).toBeGreaterThan(0)
  })

  it('has a real guide behind every tab', async () => {
    render(<HelpPage />)
    await userEvent.click(screen.getByRole('tab', { name: 'Match operator' }))
    expect(screen.getByRole('heading', { name: 'Match operator guide', level: 1 })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Administrator' }))
    expect(screen.getByRole('heading', { name: 'Administrator guide', level: 1 })).toBeInTheDocument()
  })

  it('describes every screen in the navigation', () => {
    render(<HelpPage />)
    const table = screen.getAllByRole('table').map((t) => t.textContent ?? '').join(' ')
    for (const item of NAV) expect(table).toContain(item.label)
  })
})
