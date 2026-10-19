import { useEffect, useRef, useState } from 'react'

const GOOGLE_IDENTITY_SERVICES_URL = 'https://accounts.google.com/gsi/client'

// keep the overlay button and the hidden Google button the same size so a
// click always lands on Google's real button underneath.
const BUTTON_WIDTH_PX = 280
const BUTTON_HEIGHT_CLASS = 'h-11'

let gisScriptPromise = null

// load the Google Identity Services script once
function loadGoogleIdentityServices() {
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

// custom logo-less sign-in button over Google's hidden official button
export function GoogleSignIn({
  clientId,
  onCredential,
  locale = 'en',
  errorText = 'Sign-in failed. Please try again.',
  label = 'Sign in with Google',
}) {
  const credentialHandlerRef = useRef(onCredential)
  const buttonContainerRef = useRef(null)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    credentialHandlerRef.current = onCredential
  }, [onCredential])

  useEffect(() => {
    let cancelled = false

    loadGoogleIdentityServices()
      .then(() => {
        if (cancelled || !buttonContainerRef.current) return

        window.google?.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            if (!response.credential) {
              setError(errorText)
              return
            }

            setError(null)
            setSubmitting(true)

            Promise.resolve(credentialHandlerRef.current(response.credential))
              .catch((authError) => {
                // surface the server's real reason (e.g. invalid token,
                // unlinked account) instead of a generic message
                if (!cancelled) {
                  setError(authError?.message || errorText)
                }
              })
              .finally(() => {
                if (!cancelled) setSubmitting(false)
              })
          },
        })

        // Google's real button is rendered invisibly; the visible custom
        // button above it is pointer-events-none, so a click passes straight
        // through to this button and the official flow still runs.
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
    <div className="space-y-3">
      <div
        className="relative flex justify-center"
        style={{ width: BUTTON_WIDTH_PX }}
      >
        {/* Google's official button, kept clickable but visually hidden */}
        <div
          ref={buttonContainerRef}
          className={`absolute inset-0 opacity-0 ${BUTTON_HEIGHT_CLASS}`}
          aria-hidden="true"
        />

        {/* our logo-less button drawn on top; clicks fall through to Google */}
        <button
          type="button"
          disabled={submitting}
          className={`pointer-events-none relative z-10 w-full ${BUTTON_HEIGHT_CLASS} rounded-lg bg-white px-5 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60`}
        >
          {submitting ? 'Signing in…' : label}
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
