
import { useEffect, useRef, useState } from 'react'

const GOOGLE_IDENTITY_SERVICES_URL =
  'https://accounts.google.com/gsi/client'

const BUTTON_WIDTH_PX = 280
const BUTTON_HEIGHT_CLASS = 'h-11'

let gisScriptPromise = null

function trace(step, details = {}) {
  console.info('[google-signin]', step, details)
}

export function loadGoogleIdentityServices() {
  if (typeof window === 'undefined') {
    trace('gis.skip.ssr')
    return Promise.resolve()
  }

  if (window.google?.accounts.id) {
    trace('gis.already_loaded')
    return Promise.resolve()
  }

  if (!gisScriptPromise) {
    trace('gis.script.loading', { src: GOOGLE_IDENTITY_SERVICES_URL })

    gisScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')

      script.src = GOOGLE_IDENTITY_SERVICES_URL
      script.async = true
      script.defer = true

      script.onload = () => {
        trace('gis.script.loaded', {
          hasAccountsId: Boolean(window.google?.accounts?.id),
        })
        resolve()
      }

      script.onerror = () => {
        trace('gis.script.failed')
        gisScriptPromise = null
        reject(new Error('Unable to load Google Sign-In.'))
      }

      document.head.append(script)
    })
  }

  return gisScriptPromise
}

export function GoogleSignIn({
  clientId,
  onCredential,
  locale = 'en',
  errorText = 'Sign-in failed. Please try again.',
  label = 'Sign in with Google',
}) {
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const buttonContainerRef = useRef(null)
  const credentialHandlerRef = useRef(onCredential)
  const submittingRef = useRef(false)

  useEffect(() => {
    credentialHandlerRef.current = onCredential
  }, [onCredential])
  useEffect(() => {
    let cancelled = false

    if (!clientId) {
      trace('init.skip.no_client_id')
      return
    }

    trace('init.start', { clientId, locale })

    loadGoogleIdentityServices()
      .then(() => {
        if (
          cancelled ||
          !buttonContainerRef.current ||
          typeof window === 'undefined'
        ) {
          trace('init.aborted', {
            cancelled,
            hasContainer: Boolean(buttonContainerRef.current),
          })
          return
        }

        trace('init.initialize', { clientId })

        window.google.accounts.id.initialize({
          client_id: clientId,

          callback: (response) => {
            trace('click.callback', {
              hasCredential: Boolean(response?.credential),
              submitting: submittingRef.current,
            })

            if (!response?.credential) {
              trace('click.no_credential')
              setError(errorText)
              return
            }

            if (submittingRef.current) {
              trace('click.ignored_duplicate')
              return
            }

            submittingRef.current = true
            setError(null)
            setSubmitting(true)

            trace('credential.handoff.start')

            Promise.resolve(
              credentialHandlerRef.current(response.credential)
            )
              .then(() => {
                trace('credential.handoff.success')
              })
              .catch((authError) => {
                trace('credential.handoff.failed', {
                  message: authError?.message,
                  name: authError?.name,
                })

                if (!cancelled) {
                  setError(authError?.message || errorText)
                }
              })
              .finally(() => {
                submittingRef.current = false

                if (!cancelled) {
                  setSubmitting(false)
                }

                trace('credential.handoff.done')
              })
          },
        })

        trace('init.render_button', {
          width: BUTTON_WIDTH_PX,
          locale,
        })

        window.google.accounts.id.renderButton(
          buttonContainerRef.current,
          {
            theme: 'outline',
            size: 'large',
            width: BUTTON_WIDTH_PX,
            text: 'continue_with',
            locale,
          }
        )

        const renderedButton =
          buttonContainerRef.current.querySelector('iframe')

        trace('init.render_button.done', {
          hasIframe: Boolean(renderedButton),
          childCount: buttonContainerRef.current.childElementCount,
        })
      })
      .catch((error) => {
        trace('init.failed', {
          message: error?.message,
          name: error?.name,
        })

        if (!cancelled) {
          setError('Unable to load Google Sign-In.')
        }
      })

    return () => {
      trace('init.cleanup')
      cancelled = true
    }
  }, [clientId, locale, errorText])
  return (
    <div className="w-full space-y-2">
      <div
        className="relative flex justify-center mx-auto"
        style={{
          width: '100%',
          maxWidth: BUTTON_WIDTH_PX,
        }}
      >
        {/* Actual Google button: receives mouse clicks */}
        <div
          ref={buttonContainerRef}
          className={`absolute inset-0 opacity-0 ${BUTTON_HEIGHT_CLASS}`}
          aria-hidden="true"
        />

        {/* Visual button: must not block Google's iframe */}
        <button
          type="button"
          disabled={submitting}
          className={`pointer-events-none relative z-10 w-full ${BUTTON_HEIGHT_CLASS} rounded-xl bg-white dark:bg-[#17202B] px-5 text-sm font-semibold text-[#344054] dark:text-[#F2F4F7] ring-1 ring-[#D0D5DD] dark:ring-[#344054] shadow-sm transition disabled:opacity-60`}
        >
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
