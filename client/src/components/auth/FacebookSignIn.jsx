import { useEffect, useRef, useState } from 'react'

const FACEBOOK_SDK_URL = 'https://connect.facebook.net/en_US/sdk.js'
const FACEBOOK_API_VERSION = 'v21.0'

let facebookSdkPromise = null

// load the Facebook JS SDK once and initialize it for the given app
function loadFacebookSdk(appId) {
  if (window.FB) {
    window.FB.init({
      appId,
      cookie: true,
      xfbml: false,
      version: FACEBOOK_API_VERSION,
    })
    return Promise.resolve()
  }

  if (!facebookSdkPromise) {
    facebookSdkPromise = new Promise((resolve, reject) => {
      window.fbAsyncInit = () => {
        resolve()
      }

      const script = document.createElement('script')
      script.src = FACEBOOK_SDK_URL
      script.async = true
      script.defer = true
      script.crossOrigin = 'anonymous'
      script.onerror = () => {
        facebookSdkPromise = null
        reject(new Error('Unable to load Facebook Login.'))
      }
      document.head.append(script)
    })
  }

  return facebookSdkPromise.then(() => {
    window.FB.init({
      appId,
      cookie: true,
      xfbml: false,
      version: FACEBOOK_API_VERSION,
    })
  })
}

// ask Facebook for an access token and hand it to the server for verification
export function FacebookSignIn({
  appId,
  onAccessToken,
  errorText = 'Sign-in failed. Please try again.',
  label = 'Sign in with Facebook',
}) {
  const tokenHandlerRef = useRef(onAccessToken)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    tokenHandlerRef.current = onAccessToken
  }, [onAccessToken])

  async function handleClick() {
    if (submitting) return

    setSubmitting(true)
    setError(null)

    try {
      await loadFacebookSdk(appId)

      const response = await new Promise((resolve) => {
        window.FB.login((result) => resolve(result), { scope: 'email,public_profile' })
      })

      const accessToken = response?.authResponse?.accessToken

      if (!accessToken) {
        // the user dismissed the dialog; do not treat it as an error
        setSubmitting(false)
        return
      }

      await tokenHandlerRef.current(accessToken)
    } catch (authError) {
      setError(authError?.message || errorText)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={submitting}
        className="flex h-11 w-full items-center justify-center rounded-lg bg-[#1877F2] px-5 text-sm font-semibold text-white transition hover:bg-[#166fe5] focus:outline-none focus:ring-2 focus:ring-[#1877F2] focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
      >
        {submitting ? 'Signing in…' : label}
      </button>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
