import { useEffect, useRef, useState } from 'react'

const GOOGLE_IDENTITY_SERVICES_URL = 'https://accounts.google.com/gsi/client'

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

// render the official Google sign-in button and offer One Tap for returning visitors
export function GoogleSignIn({
  clientId,
  onCredential,
  locale = 'en',
  errorText = 'Sign-in failed. Please try again.',
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
              .catch(() => {
                if (!cancelled) setError(errorText)
              })
              .finally(() => {
                if (!cancelled) setSubmitting(false)
              })
          },
        })

        // official Google button: reliable across browsers, unlike One Tap alone
        window.google.accounts.id.renderButton(buttonContainerRef.current, {
          theme: 'outline',
          size: 'large',
          width: 280,
          text: 'continue_with',
          locale,
        })

        // opportunistic One Tap for returning users; never required
        window.google.accounts.id.prompt()
      })
      .catch(() => {
        if (!cancelled) setError('Unable to load Google Sign-In.')
      })

    return () => {
      cancelled = true
    }
  }, [clientId, locale, errorText])

  if (error) {
    return (
      <div className="space-y-3">
        <div
          ref={buttonContainerRef}
          className="[&>div]:w-full"
          aria-hidden="true"
        />
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div ref={buttonContainerRef} className="[&>div]:w-full" />
      {submitting && (
        <p className="text-center text-sm text-slate-500">Signing in…</p>
      )}
    </div>
  )
}
