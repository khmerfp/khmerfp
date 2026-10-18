import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/authContext.js'
import { useLanguage } from '../auth/LanguageContext.js'
import { AuthShell } from '../components/auth/AuthShell.jsx'
import {
  enrollTelegram,
  getFactors,
  logoutAll,
  stepUpWithTelegram,
} from '../services/authApi.js'

// load the official Telegram Login Widget for the configured bot
function TelegramLoginWidget({ botUsername, onAuth }) {
  const containerRef = useRef(null)
  const onAuthRef = useRef(onAuth)

  useEffect(() => {
    onAuthRef.current = onAuth
  }, [onAuth])

  useEffect(() => {
    if (!botUsername || !containerRef.current) return undefined

    const container = containerRef.current

    window.onTelegramAuth = (telegramUser) => {
      void onAuthRef.current(telegramUser)
    }

    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.async = true
    script.setAttribute('data-telegram-login', botUsername)
    script.setAttribute('data-size', 'large')
    script.setAttribute('data-radius', '10')
    script.setAttribute('data-userpic', 'false')
    script.setAttribute('data-onauth', 'onTelegramAuth(user)')
    script.setAttribute('data-request-access', 'write')
    container.append(script)

    return () => {
      delete window.onTelegramAuth
      container.replaceChildren()
    }
  }, [botUsername])

  return <div ref={containerRef} className="flex justify-center" />
}

// signed-in account security screen: Telegram second factor and sign-out-everywhere
export function SecurityPage() {
  const { user, status, telegramBotUsername, logout } = useAuth()
  const { text } = useLanguage()
  const [factors, setFactors] = useState(null)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)
  const [isWorking, setIsWorking] = useState(false)

  useEffect(() => {
    if (status === 'unauthenticated') {
      window.location.assign('/login')
    }
  }, [status])

  useEffect(() => {
    if (!user) return undefined

    let cancelled = false

    getFactors()
      .then((value) => {
        if (!cancelled) setFactors(value)
      })
      .catch(() => {
        if (!cancelled) setError(text.widgetUnavailable)
      })

    return () => {
      cancelled = true
    }
  }, [user, text.widgetUnavailable])

  const handleTelegramAuth = useCallback(
    async (telegramUser) => {
      if (isWorking) return

      setIsWorking(true)
      setNotice(null)
      setError(null)

      try {
        if (factors?.telegram?.enrolled) {
          await stepUpWithTelegram(telegramUser)
          setNotice(text.stepUpDone)
        } else {
          const nextFactors = await enrollTelegram(telegramUser)
          setFactors(nextFactors)
          setNotice(text.telegramConnected)
        }
      } catch (authError) {
        setError(
          authError instanceof Error
            ? authError.message
            : 'Something went wrong. Try again.',
        )
      } finally {
        setIsWorking(false)
      }
    },
    [factors, isWorking, text],
  )

  const handleLogoutAll = useCallback(async () => {
    if (isWorking) return

    setIsWorking(true)
    setError(null)

    try {
      await logoutAll()
      await logout()
      setNotice(text.signOutEverywhereDone)
    } catch {
      setError('Sign-out failed. Try again.')
    } finally {
      setIsWorking(false)
    }
  }, [isWorking, logout, text.signOutEverywhereDone])

  if (status === 'loading' || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-slate-500">
        {text.checkingSession}
      </main>
    )
  }

  const telegramEnrolled = Boolean(factors?.telegram?.enrolled)

  return (
    <AuthShell title={text.securityTitle} subtitle={text.securitySubtitle}>
      <section className="rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-800">Telegram</p>
            <p className="mt-1 text-xs text-slate-500">
              {telegramEnrolled
                ? text.telegramConnected
                : text.telegramNotConnected}
            </p>
            {telegramEnrolled && factors.telegram.verifiedAt && (
              <p className="mt-1 text-xs text-slate-400">
                {text.verifiedAt}:{' '}
                {new Date(factors.telegram.verifiedAt).toLocaleDateString()}
              </p>
            )}
          </div>
          <span
            className={
              telegramEnrolled
                ? 'rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700'
                : 'rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800'
            }
          >
            {telegramEnrolled ? 'ON' : 'OFF'}
          </span>
        </div>

        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
          {text.telegramRequiredNote}
        </p>

        <div className="mt-4">
          {!telegramBotUsername ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {text.widgetUnavailable}
            </p>
          ) : (
            <TelegramLoginWidget
              botUsername={telegramBotUsername}
              onAuth={handleTelegramAuth}
            />
          )}

          {isWorking && (
            <p className="mt-2 text-center text-xs text-slate-500">
              {text.verifying}
            </p>
          )}
        </div>
      </section>

      {notice && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void handleLogoutAll()}
        disabled={isWorking}
        className="w-full rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
      >
        {text.signOutEverywhere}
      </button>
    </AuthShell>
  )
}
