
import { useEffect, useRef, useState } from 'react'

const GOOGLE_IDENTITY_SERVICES_URL =
  'https://accounts.google.com/gsi/client'

const BUTTON_WIDTH_PX = 280


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
  theme = 'outline',
  errorText = 'Sign-in failed. Please try again.',
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

        const buttonContainer = buttonContainerRef.current

        // Google's rendered button must remain the visible click target.
        // Hiding its iframe behind a custom button is not a supported GIS flow.
        buttonContainer.replaceChildren()
        window.google.accounts.id.renderButton(
          buttonContainer,
          {
            theme,
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
  }, [clientId, locale, theme, errorText])
  return (
    <div className="w-full space-y-2">
      <div
        className="flex min-h-11 justify-center mx-auto transition-opacity"
        style={{
          width: '100%',
          maxWidth: BUTTON_WIDTH_PX,
        }}
      >
        <div
          ref={buttonContainerRef}
          className={submitting ? 'pointer-events-none opacity-60' : ''}
        />
      </div>

      {submitting && (
        <p className="text-xs text-[#667085] dark:text-[#98A2B3] text-center" aria-live="polite">
          Signing in&hellip;
        </p>
      )}

      {error && (
        <p className="text-xs text-[#E15A4D] text-center">
          {error}
        </p>
      )}
    </div>
  )
}
