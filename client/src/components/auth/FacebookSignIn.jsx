import { useEffect, useRef, useState } from 'react'

// Meta publishes the JavaScript SDK per locale. Khmer is not published, so the
// English bundle is used for every supported app language.
const FACEBOOK_SDK_URL = 'https://connect.facebook.net/en_US/sdk.js'
const FACEBOOK_GRAPH_VERSION = 'v26.0'
const BUTTON_WIDTH_PX = 280
const BUTTON_HEIGHT_CLASS = 'h-11'

let facebookSdkPromise = null

function loadFacebookSdk() {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.FB) return Promise.resolve()

  if (!facebookSdkPromise) {
    facebookSdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = FACEBOOK_SDK_URL
      script.async = true
      script.defer = true
      script.onload = () => resolve()
      script.onerror = () => {
        facebookSdkPromise = null
        reject(new Error('Unable to load Facebook Sign-In.'))
      }
      document.head.append(script)
    })
  }

  return facebookSdkPromise
}

// The redirect URI the Facebook login dialog returns to. It must match the
// one used when the dialog was opened, so it is derived from the page URL in
// the same way the SDK derives it.
function currentRedirectUri() {
  if (typeof window === 'undefined') return null

  return `${window.location.origin}${window.location.pathname}`
}

// The official Facebook mark, drawn locally so the button needs no remote image.
function FacebookMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <path
        fill="#1877F2"
        d="M22.675 0h-21.35C.593 0 0 .593 0 1.325v21.351C0 23.407.593 24 1.325 24H12.82v-9.294H9.692v-3.622h3.128V8.413c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.099 2.795.143v3.24l-1.918.001c-1.504 0-1.795.715-1.795 1.763v2.313h3.587l-.467 3.622h-3.12V24h6.116c.73 0 1.324-.593 1.324-1.325V1.325C24 .593 23.407 0 22.675 0z"
      />
    </svg>
  )
}

export function FacebookSignIn({
  appId,
  onAccessToken,
  onAuthorizationCode,
  errorText = 'Sign-in failed. Please try again.',
  cancelledText = 'Facebook sign-in was cancelled.',
  label = 'Sign in with Facebook',
}) {
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [ready, setReady] = useState(false)
  const accessTokenHandlerRef = useRef(onAccessToken)
  const authorizationCodeHandlerRef = useRef(onAuthorizationCode)

  useEffect(() => {
    accessTokenHandlerRef.current = onAccessToken
  }, [onAccessToken])

  useEffect(() => {
    authorizationCodeHandlerRef.current = onAuthorizationCode
  }, [onAuthorizationCode])

  useEffect(() => {
    let cancelled = false
    if (!appId) return undefined

    loadFacebookSdk()
      .then(() => {
        if (cancelled || typeof window === 'undefined') return

        window.FB?.init({
          appId,
          cookie: true,
          xfbml: false,
          version: FACEBOOK_GRAPH_VERSION,
        })

        setReady(true)
      })
      .catch(() => {
        if (!cancelled) setError('Unable to load Facebook Sign-In.')
      })

    return () => {
      cancelled = true
    }
  }, [appId])

  const handleLogin = () => {
    if (submitting) return

    const facebook = typeof window === 'undefined' ? null : window.FB

    if (!facebook?.login) {
      setError('Unable to load Facebook Sign-In.')
      return
    }

    setError(null)
    setSubmitting(true)

    // The SDK resolves with the user access token, which the server verifies
    // against the Graph API before a session is issued. When the dialog
    // answers with an authorization code instead, the server exchanges it.
    facebook.login(
      (response) => {
        if (response?.status !== 'connected') {
          setSubmitting(false)
          setError(cancelledText)
          return
        }

        const accessToken = response?.authResponse?.accessToken
        const code = response?.authResponse?.code

        if (!accessToken && !code) {
          setSubmitting(false)
          setError(errorText)
          return
        }

        const handler = accessToken
          ? () => accessTokenHandlerRef.current(accessToken)
          : () => {
              if (typeof authorizationCodeHandlerRef.current !== 'function') {
                throw new Error(errorText)
              }

              return authorizationCodeHandlerRef.current(code, currentRedirectUri())
            }

        Promise.resolve()
          .then(handler)
          .catch((authError) => {
            setError(authError?.message || errorText)
          })
          .finally(() => {
            setSubmitting(false)
          })
      },
      { scope: 'public_profile', response_type: 'token' },
    )
  }

  return (
    <div className="space-y-2 w-full">
      <div className="relative flex justify-center" style={{ width: '100%', maxWidth: BUTTON_WIDTH_PX }}>
        <button
          type="button"
          onClick={handleLogin}
          disabled={!ready || submitting}
          className={`w-full ${BUTTON_HEIGHT_CLASS} rounded-lg bg-white px-5 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-50 disabled:opacity-60 flex items-center justify-center gap-2`}
        >
          <FacebookMark />
          {submitting ? 'Signing in…' : label}
        </button>
      </div>
      {error && <p className="text-xs text-[#E15A4D] text-center">{error}</p>}
    </div>
  )
}
