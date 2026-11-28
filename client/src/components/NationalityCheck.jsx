import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { apiRequest } from '../lib/api.js'
import { getCurrentUser } from '../services/authApi.js'
import { useAuth } from '../auth/authContext.js'

function dismissalKey(userId) {
  return `khmerfp-nationality-check-dismissed-v2:${userId}`
}

function wasDismissed(userId) {
  try {
    return window.localStorage.getItem(dismissalKey(userId)) === 'yes'
  } catch {
    return false
  }
}

export default function NationalityCheck() {
  const { user, status } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)
  const [checking, setChecking] = useState(false)
  const [loginToken, setLoginToken] = useState(null)
  const [error, setError] = useState('')
  const dismissedUserId = useRef(null)
  const lastAuthenticatedUserId = useRef(null)

  useEffect(() => {
    let cancelled = false

    async function checkIdentity() {
      if (status === 'unauthenticated') {
        const previousUserId = lastAuthenticatedUserId.current
        if (previousUserId) {
          try {
            window.localStorage.removeItem(dismissalKey(previousUserId))
          } catch {
            // The prompt will still appear on the next login if storage is unavailable.
          }
        }
        lastAuthenticatedUserId.current = null
        dismissedUserId.current = null
        setVisible(false)
        setChecking(false)
        setLoginToken(null)
        return
      }

      if (status === 'authenticated' && user?.id) {
        lastAuthenticatedUserId.current = user.id
      }

      if (
        status !== 'authenticated'
        || !user?.id
        || location.pathname === '/verify-result'
      ) return

      if (dismissedUserId.current === user.id || wasDismissed(user.id)) {
        setVisible(false)
        setChecking(false)
        return
      }

      setChecking(true)
      try {
        const currentUser = await getCurrentUser()
        if (cancelled) return

        if (currentUser?.identity_verified_at) {
          try {
            window.localStorage.removeItem(dismissalKey(user.id))
          } catch {
            // Identity status remains authoritative if browser storage is unavailable.
          }
          setVisible(false)
          return
        }

        setVisible(true)
      } catch {
        if (!cancelled) setVisible(true)
      } finally {
        if (!cancelled) setChecking(false)
      }
    }

    void checkIdentity()
    return () => { cancelled = true }
  }, [location.pathname, status, user?.id])

  async function startVerification() {
    setError('')
    setLoginToken(null)
    try {
      const data = await apiRequest('/api/camdigikey/login-token', {
        method: 'POST',
      })
      setLoginToken(data.loginToken)
    } catch {
      setError('The verification is currently under maintenance, will be ready soon..')
    }
  }

  function continueToHome() {
    dismissedUserId.current = user?.id
    if (user?.id) {
      try {
        window.localStorage.setItem(dismissalKey(user.id), 'yes')
      } catch {
        // The in-memory dismissal still applies until this app session ends.
      }
    }
    setVisible(false)
    navigate('/')
  }

  if (!visible && !checking) return null

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 px-4 py-8">
      <section
        aria-labelledby="nationality-check-title"
        aria-modal="true"
        className="max-h-full w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 text-[#0A0E14] shadow-2xl dark:bg-[#111821] dark:text-white"
        role="dialog"
      >
        {checking ? (
          <p className="text-sm text-[#5B6472] dark:text-white/70">
            Checking your identity statusÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦
          </p>
        ) : (
          <>
            <h1 id="nationality-check-title" className="mb-3 text-xl font-semibold">
              Are you a Cambodian national?
            </h1>
            <p className="mb-6 text-sm text-[#5B6472] dark:text-white/70">
              To continue, verify your identity with CamDigiKey using a Cambodian national ID card.
            </p>
          </>
        )}

        {!checking && !loginToken ? (
          <div className="flex gap-3">
            <button
              className="flex-1 rounded-lg bg-[#33C7A6] px-4 py-3 text-sm font-semibold text-[#07110F]"
              onClick={startVerification}
              type="button"
            >
              Yes
            </button>
            <button
              className="flex-1 rounded-lg border border-[#DCE1E7] px-4 py-3 text-sm font-semibold dark:border-[#303A47]"
              onClick={continueToHome}
              type="button"
            >
              No
            </button>
          </div>
        ) : !checking && loginToken ? (
          <div className="text-center">
            <p className="mb-4 text-sm text-[#5B6472] dark:text-white/70">
              Open CamDigiKey and scan this code to continue.
            </p>
            <QRCodeSVG className="mx-auto" value={loginToken} size={220} />
          </div>
        ) : null}

        {error && <p className="mt-4 text-sm text-[#D94F45]">{error}</p>}
      </section>
    </div>
  )
}
