
import { useEffect, useRef, useState } from 'react'

// Facebook JavaScript SDK configuration
const FACEBOOK_SDK_URL =
  'https://connect.facebook.net/en_US/sdk.js'

const FACEBOOK_GRAPH_VERSION = 'v26.0'

const BUTTON_WIDTH_PX = 280
const BUTTON_HEIGHT_CLASS = 'h-11'

let facebookSdkPromise = null
let facebookInitializedAppId = null

// Load Facebook SDK once
function loadFacebookSdk() {
  if (typeof window === 'undefined') {
    return Promise.reject(
      new Error('Facebook login is only available in the browser.')
    )
  }

  if (window.FB) {
    return Promise.resolve()
  }

  if (!facebookSdkPromise) {
    facebookSdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')

      script.src = FACEBOOK_SDK_URL
      script.async = true
      script.defer = true

      script.onload = () => {
        if (window.FB) {
          resolve()
        } else {
          facebookSdkPromise = null
          reject(new Error('Facebook SDK initialization failed.'))
        }
      }

      script.onerror = () => {
        facebookSdkPromise = null
        reject(new Error('Unable to load Facebook Sign-In.'))
      }

      document.head.appendChild(script)
    })
  }

  return facebookSdkPromise
}

// Initialize the SDK once per app id. Repeated mounts (and React Strict Mode)
// must not call FB.init again with the same configuration.
async function initFacebookSdk(appId) {
  await loadFacebookSdk()

  if (!window.FB) {
    throw new Error('Facebook SDK initialization failed.')
  }

  if (facebookInitializedAppId !== appId) {
    window.FB.init({
      appId,
      cookie: true,
      xfbml: false,
      version: FACEBOOK_GRAPH_VERSION,
    })

    facebookInitializedAppId = appId
  }

  return window.FB
}

// Facebook logo
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
  errorText = 'Sign-in failed. Please try again.',
  cancelledText = 'Facebook sign-in was cancelled.',
  label = 'Sign in with Facebook',
}) {
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [ready, setReady] = useState(false)

  const accessTokenHandlerRef = useRef(onAccessToken)

  // Keep the latest callback
  useEffect(() => {
    accessTokenHandlerRef.current = onAccessToken
  }, [onAccessToken])

  // Initialize Facebook SDK
  useEffect(() => {
    let cancelled = false

    setReady(false)

    if (!appId) {
      setError('Facebook App ID is missing.')
      return undefined
    }

    initFacebookSdk(appId)
      .then(() => {
        if (cancelled) return

        setReady(true)
        setError(null)
      })
      .catch((sdkError) => {
        if (!cancelled) {
          setError(
            sdkError?.message || 'Unable to load Facebook Sign-In.'
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [appId])

  // Facebook login requests public_profile plus the optional email permission.
  const handleLogin = () => {
    if (submitting) return

    const facebook =
      typeof window !== 'undefined' ? window.FB : null

    if (!facebook?.login) {
      setError('Unable to load Facebook Sign-In.')
      return
    }

    if (typeof accessTokenHandlerRef.current !== 'function') {
      setError('Facebook authentication handler is unavailable.')
      return
    }

    setError(null)
    setSubmitting(true)

    // FB.login requires a plain function. Passing an async callback makes the
    // SDK throw "Expression is of type asyncfunction, not function".
    const handleLoginResponse = async (response) => {
      try {
        if (response?.status !== 'connected') {
          setError(cancelledText)
          return
        }

        const accessToken =
          response?.authResponse?.accessToken

        if (!accessToken) {
          throw new Error('Facebook access token is missing.')
        }

        // Send token to backend for verification
        await accessTokenHandlerRef.current(accessToken)
      } catch (authError) {
        setError(authError?.message || errorText)
      } finally {
        setSubmitting(false)
      }
    }

    try {
      facebook.login(
        (response) => {
          void handleLoginResponse(response)
        },
        {
          scope: 'public_profile,email',
        }
      )
    } catch (loginError) {
      setSubmitting(false)
      setError(loginError?.message || errorText)
    }
  }

  return (
    <div className="w-full space-y-2">
      <div
        className="relative flex justify-center"
        style={{
          width: '100%',
          maxWidth: BUTTON_WIDTH_PX,
        }}
      >
        <button
          type="button"
          onClick={handleLogin}
          disabled={!ready || submitting}
          className={`
            w-full
            ${BUTTON_HEIGHT_CLASS}
            rounded-lg
            bg-white
            px-5
            text-sm
            font-semibold
            text-slate-700
            ring-1
            ring-slate-300
            transition
            hover:bg-slate-50
            disabled:opacity-60
            flex
            items-center
            justify-center
            gap-2
          `}
        >
          <FacebookMark />

          {submitting ? 'Signing in…' : label}
        </button>
      </div>

      {error && (
        <p className="text-xs text-[#E15A4D] text-center">
          {error}
        </p>
      )}
    </div>
  )
}
