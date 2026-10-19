import { useEffect } from 'react'
import { useAuth } from '../auth/authContext.js'
import { useLanguage } from '../auth/LanguageContext.js'
import { AuthShell } from '../components/auth/AuthShell.jsx'
import { GoogleSignIn } from '../components/auth/GoogleSignIn.jsx'
import { EmailPasswordForm } from '../components/auth/EmailPasswordForm.jsx'

// render the sign-in screen with Google and email/password options
export function LoginPage() {
  const {
    user,
    status,
    googleClientId,
    loginWithGoogle,
    loginWithEmail,
    registerWithEmail,
  } = useAuth()
  const { language, text } = useLanguage()

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

  return (
    <AuthShell title={text.signInTitle} subtitle={text.signInSubtitle}>
      <EmailPasswordForm
        onSignIn={(payload) => loginWithEmail(payload)}
        onRegister={(payload) => registerWithEmail(payload)}
      />

      {googleClientId ? (
        <>
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {text.orContinueWithGoogle}
            </span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <GoogleSignIn
            clientId={googleClientId}
            locale={language}
            errorText={text.signInFailed}
            label={text.signInWithGoogle}
            onCredential={(credential) => loginWithGoogle(credential, language)}
          />
        </>
      ) : (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {text.googleNotConfigured}
        </p>
      )}

      <p className="text-center text-xs leading-5 text-slate-500">
        {text.firstSignInNote}
      </p>
    </AuthShell>
  )
}
