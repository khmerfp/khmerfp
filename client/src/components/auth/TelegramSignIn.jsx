import { useEffect, useRef, useState } from 'react'

// render the official Telegram Login Widget for first-party sign-in. The same
// widget is also used on the security page to enroll the second factor; here it
// establishes a session through /api/auth/telegram.
export function TelegramSignIn({ botUsername, onAuth, errorText = 'Sign-in failed. Please try again.' }) {
  const containerRef = useRef(null)
  const onAuthRef = useRef(onAuth)
  const [error, setError] = useState(null)

  useEffect(() => {
    onAuthRef.current = onAuth
  }, [onAuth])

  useEffect(() => {
    if (!botUsername || !containerRef.current) return undefined

    const container = containerRef.current

    window.onTelegramAuth = (telegramUser) => {
      Promise.resolve(onAuthRef.current(telegramUser)).catch((authError) => {
        setError(authError?.message || errorText)
      })
    }

    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.async = true
    script.setAttribute('data-telegram-login', botUsername)
    script.setAttribute('data-size', 'large')
    script.setAttribute('data-radius', '10')
    script.setAttribute('data-userpic', 'false')
    script.setAttribute('data-onauth', 'onTelegramAuth(user)')
    script.setAttribute('data-request-access', 'write')
    container.append(script)

    return () => {
      delete window.onTelegramAuth
      container.replaceChildren()
    }
  }, [botUsername, errorText])

  return (
    <div className="space-y-3">
      <div ref={containerRef} className="flex justify-center" />

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
