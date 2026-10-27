import { useEffect, useRef, useState } from 'react'

const TELEGRAM_WIDGET_SCRIPT = 'https://telegram.org/js/telegram-widget.js?22'

let telegramWidgetScriptPromise = null

function loadTelegramWidgetScript() {
  if (typeof window === 'undefined') return Promise.resolve()
  if (document.querySelector(`script[src^="https://telegram.org/js/telegram-widget.js"]`)) {
    return Promise.resolve()
  }

  if (!telegramWidgetScriptPromise) {
    telegramWidgetScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = TELEGRAM_WIDGET_SCRIPT
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => {
        telegramWidgetScriptPromise = null
        reject(new Error('Unable to load Telegram Login Widget.'))
      }
      document.head.append(script)
    })
  }

  return telegramWidgetScriptPromise
}

export function TelegramSignIn({
  botUsername,
  onAuth,
  errorText = 'Sign-in failed. Please try again.',
  label = 'Sign in with Telegram',
}) {
  const containerRef = useRef(null)
  const authHandlerRef = useRef(onAuth)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    authHandlerRef.current = onAuth
  }, [onAuth])

  useEffect(() => {
    let cancelled = false
    if (!botUsername || typeof window === 'undefined') return

    const globalCallbackName = `telegramLoginCallback_${Math.random().toString(36).slice(2, 11)}`

    window[globalCallbackName] = (user) => {
      if (cancelled) return
      setError(null)
      setSubmitting(true)

      Promise.resolve(authHandlerRef.current?.(user))
        .catch((authError) => {
          if (!cancelled) {
            setError(authError?.message || errorText)
          }
        })
        .finally(() => {
          if (!cancelled) {
            setSubmitting(false)
          }
          try {
            delete window[globalCallbackName]
          } catch {
            // ignore
          }
        })
    }

    loadTelegramWidgetScript()
      .then(() => {
        if (cancelled || !containerRef.current) return

        containerRef.current.innerHTML = ''

        const script = document.createElement('script')
        script.src = `https://telegram.org/js/telegram-widget.js?22`
        script.async = true
        script.setAttribute('data-telegram-login', botUsername)
        script.setAttribute('data-size', 'large')
        script.setAttribute('data-radius', '8')
        script.setAttribute('data-onauth', `${globalCallbackName}(user)`)
        script.setAttribute('data-request-access', 'write')
        containerRef.current.appendChild(script)
      })
      .catch(() => {
        if (!cancelled) setError('Unable to load Telegram Login Widget.')
      })

    return () => {
      cancelled = true
      try {
        delete window[globalCallbackName]
      } catch {
        // ignore
      }
    }
  }, [botUsername, errorText])

  if (!botUsername) return null

  return (
    <div className="space-y-2 w-full">
      <div className="relative flex justify-center" style={{ width: '100%', maxWidth: 280 }}>
        <div ref={containerRef} className="flex justify-center" />
        {submitting && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 dark:bg-[#0F141B]/70 rounded-lg">
            <span className="text-xs text-[#5B6472] dark:text-[#7C8697]">Signing in…</span>
          </div>
        )}
      </div>
      {error && <p className="text-xs text-[#E15A4D] text-center">{error}</p>}
    </div>
  )
}
