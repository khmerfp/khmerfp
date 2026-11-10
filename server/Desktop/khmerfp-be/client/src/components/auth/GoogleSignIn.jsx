import { useEffect, useRef, useState } from 'react'

const GOOGLE_IDENTITY_SERVICES_URL = 'https://accounts.google.com/gsi/client'

const BUTTON_WIDTH_PX = 280
const BUTTON_HEIGHT_CLASS = 'h-11'

let gisScriptPromise = null

function loadGoogleIdentityServices() {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.google?.accounts.id) return Promise.resolve()

  if (!gisScriptPromise) {
    gisScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = GOOGLE_IDENTITY_SERVICES_URL
      script.async = true
      script.defer = true
      script.onload = () => resolve()
      script.onerror = () => {
        gisScriptPromise = null
        reject(new Error('Unable to load Google Sign-In.'))
      }
      document.head.append(script)
    })
  }

  return gisScriptPromise
}

export function GoogleSignIn({ clientId, onCredential, locale = 'en', errorText = 'Sign-in failed. Please try again.', label = 'Sign in with Google' }) {
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const buttonContainerRef = useRef(null)
  const credentialHandlerRef = useRef(onCredential)

  useEffect(() => {
    credentialHandlerRef.current = onCredential
  }, [onCredential])

  useEffect(() => {
    let cancelled = false
    if (!clientId) return

    loadGoogleIdentityServices()
      .then(() => {
        if (cancelled || !buttonContainerRef.current || typeof window === 'undefined') return

        window.google?.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            if (!response?.credential) {
              setError(errorText)
              return
            }

            setError(null)
            setSubmitting(true)

            Promise.resolve(credentialHandlerRef.current(response.credential))
              .catch((authError) => {
                if (!cancelled) {
                  setError(authError?.message || errorText)
                }
              })
              .finally(() => {
                if (!cancelled) setSubmitting(false)
              })
          },
        })

        window.google.accounts.id.renderButton(buttonContainerRef.current, {
          theme: 'outline',
          size: 'large',
          width: BUTTON_WIDTH_PX,
          text: 'continue_with',
          locale,
        })
      })
      .catch(() => {
        if (!cancelled) setError('Unable to load Google Sign-In.')
      })

    return () => {
      cancelled = true
    }
  }, [clientId, locale, errorText])

  return (
    <div className="space-y-2 w-full">
      <div className="relative flex justify-center" style={{ width: '100%', maxWidth: BUTTON_WIDTH_PX }}>
        <div ref={buttonContainerRef} className={`absolute inset-0 opacity-0 ${BUTTON_HEIGHT_CLASS}`} aria-hidden="true" />
        <button
          type="button"
          disabled={submitting}
          className={`pointer-events-none relative z-10 w-full ${BUTTON_HEIGHT_CLASS} rounded-lg bg-white px-5 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 transition disabled:opacity-60`}
        >
          {submitting ? 'Signing in…' : label}
        </button>
      </div>
      {error && <p className="text-xs text-[#E15A4D] text-center">{error}</p>}
    </div>
  )
}
