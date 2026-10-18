import { useEffect } from 'react'
import { useAuth } from '../auth/authContext.js'
import { useLanguage } from '../auth/LanguageContext.js'
import { AuthShell } from '../components/auth/AuthShell.jsx'
import { GoogleSignIn } from '../components/auth/GoogleSignIn.jsx'

// render the Google-only sign-in screen
export function LoginPage() {
  const { user, status, googleClientId, loginWithGoogle } = useAuth()
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
      {!googleClientId ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {text.googleNotConfigured}
        </p>
      ) : (
        <GoogleSignIn
          clientId={googleClientId}
          locale={language}
          errorText={text.signInFailed}
          onCredential={(credential) => loginWithGoogle(credential, language)}
        />
      )}

      <p className="text-center text-xs leading-5 text-slate-500">
        {text.firstSignInNote}
      </p>
    </AuthShell>
  )
}
