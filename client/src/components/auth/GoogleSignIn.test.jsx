import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { GoogleSignIn } from './GoogleSignIn.jsx'

afterEach(() => {
  cleanup()
  delete window.google
  vi.restoreAllMocks()
})

describe('GoogleSignIn', () => {
  test('keeps the Google-rendered iframe visible as the click target', async () => {
    const renderButton = vi.fn((container) => {
      const iframe = document.createElement('iframe')
      iframe.title = 'Sign in with Google Button'
      container.append(iframe)
    })

    window.google = {
      accounts: {
        id: {
          initialize: vi.fn(),
          renderButton,
        },
      },
    }

    vi.spyOn(console, 'info').mockImplementation(() => {})

    render(
      <GoogleSignIn
        clientId="web-client-id.apps.googleusercontent.com"
        onCredential={vi.fn()}
        theme="filled_black"
      />,
    )

    const iframe = await screen.findByTitle('Sign in with Google Button')

    expect(iframe).toBeVisible()
    expect(iframe.parentElement).not.toHaveClass('opacity-0')
    expect(renderButton).toHaveBeenCalledOnce()
    expect(renderButton).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ theme: 'filled_black' }),
    )

    await waitFor(() => {
      expect(window.google.accounts.id.initialize).toHaveBeenCalledOnce()
    })
  })
})
