import { useEffect, useState } from 'react'
import { useAuth } from '../auth/authContext.js'
import { useLanguage } from '../auth/LanguageContext.js'
import { AuthShell } from '../components/auth/AuthShell.jsx'
import { GoogleSignIn } from '../components/auth/GoogleSignIn.jsx'
import { FacebookSignIn } from '../components/auth/FacebookSignIn.jsx'
import { TelegramSignIn } from '../components/auth/TelegramSignIn.jsx'
import { PhoneSignIn } from '../components/auth/PhoneSignIn.jsx'
import { EmailPasswordForm } from '../components/auth/EmailPasswordForm.jsx'

// render the sign-in screen with Google, Facebook, Telegram, phone and
// email/password options
export function LoginPage() {
  const {
    user,
    status,
    googleClientId,
    facebookAppId,
    telegramBotUsername,
    loginWithGoogle,
    loginWithFacebook,
    loginWithTelegram,
    requestPhoneCode,
    verifyPhoneCode,
    loginWithEmail,
    registerWithEmail,
  } = useAuth()
  const { language, text } = useLanguage()
  const [showPhone, setShowPhone] = useState(false)

  useEffect(() => {
    if (user) window.location.assign('/')
  }, [user])

  if (status === 'loading' || user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-slate-500">
        {text.checkingSession}
      </main>
    )
  }

  const hasAnyProvider = Boolean(
    googleClientId || facebookAppId || telegramBotUsername,
  )

  return (
    <AuthShell title={text.signInTitle} subtitle={text.signInSubtitle}>
      <EmailPasswordForm
        onSignIn={(payload) => loginWithEmail(payload)}
        onRegister={(payload) => registerWithEmail(payload)}
      />

      {hasAnyProvider && (
        <>
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {text.orContinueWith}
            </span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <div className="space-y-3">
            {googleClientId && (
              <GoogleSignIn
                clientId={googleClientId}
                locale={language}
                errorText={text.signInFailed}
                label={text.signInWithGoogle}
                onCredential={(credential) => loginWithGoogle(credential, language)}
              />
            )}

            {facebookAppId && (
              <FacebookSignIn
                appId={facebookAppId}
                errorText={text.signInFailed}
                label={text.signInWithFacebook}
                onAccessToken={(accessToken) => loginWithFacebook(accessToken, language)}
              />
            )}

            {telegramBotUsername && (
              <TelegramSignIn
                botUsername={telegramBotUsername}
                errorText={text.signInFailed}
                onAuth={(telegramUser) => loginWithTelegram(telegramUser, language)}
              />
            )}
          </div>
        </>
      )}

      <div className="space-y-3">
        {showPhone ? (
          <PhoneSignIn
            onRequestCode={(phoneNumber) => requestPhoneCode(phoneNumber)}
            onVerifyCode={(payload) => verifyPhoneCode(payload)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowPhone(true)}
            className="w-full rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            {text.signInWithPhone}
          </button>
        )}
      </div>

      <p className="text-center text-xs leading-5 text-slate-500">
        {text.firstSignInNote}
      </p>
    </AuthShell>
  )
}
