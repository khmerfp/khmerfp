
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AuthContext } from './authContext.js'
import {
  getAuthConfig,
  getInitialGoogleClientId,
  getCurrentUser,
  loginWithGoogle as loginWithGoogleRequest,
  linkGoogleAccount as linkGoogleAccountRequest,
  loginWithFacebook as loginWithFacebookRequest,
  linkFacebookAccount as linkFacebookAccountRequest,
  loginWithTelegram as loginWithTelegramRequest,
  requestPhoneCode as requestPhoneCodeRequest,
  verifyPhoneCode as verifyPhoneCodeRequest,
  loginWithEmail as loginWithEmailRequest,
  registerWithEmail as registerWithEmailRequest,
  logout as logoutRequest,
} from '../services/authApi.js'
import { loadGoogleIdentityServices } from '../components/auth/GoogleSignIn.jsx'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('loading')
  const [googleClientId, setGoogleClientId] = useState(getInitialGoogleClientId)
  const [facebookAppId, setFacebookAppId] = useState(null)
  const [telegramBotUsername, setTelegramBotUsername] = useState(null)
  const googleLoginInFlightRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    async function loadSession() {
      try {
        const [config, currentUser] = await Promise.all([
          getAuthConfig(),
          getCurrentUser().catch(() => null),
        ])

        if (cancelled) return

        setGoogleClientId(config.googleClientId)
        setFacebookAppId(config.facebookAppId)
        setTelegramBotUsername(config.telegramBotUsername)
        setUser(currentUser)
        setStatus(currentUser ? 'authenticated' : 'unauthenticated')
      } catch {
        if (cancelled) return
        setStatus('unauthenticated')
      }
    }

    void loadSession()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (googleClientId) {
      // Start downloading GIS before the authentication modal is opened.
      // The component reuses this shared promise, so this never loads twice.
      void loadGoogleIdentityServices().catch(() => {})
    }
  }, [googleClientId])

  const loginWithGoogle = useCallback((credential, language) => {
    console.info('[google-signin]', 'authprovider.login.start', {
      language,
      hasCredential: Boolean(credential),
    })

    // Reuse the pending request instead of creating a second session when a
    // duplicate credential arrives from the Google button.
    if (googleLoginInFlightRef.current) {
      console.info('[google-signin]', 'authprovider.login.reuse_inflight')
      return googleLoginInFlightRef.current
    }

    const request = loginWithGoogleRequest(credential, language)
      .then((authenticatedUser) => {
        console.info('[google-signin]', 'authprovider.login.success', {
          userId: authenticatedUser?.id,
        })
        setUser(authenticatedUser)
        setStatus('authenticated')
        return authenticatedUser
      })
      .catch((error) => {
        console.info('[google-signin]', 'authprovider.login.failed', {
          message: error?.message,
          name: error?.name,
        })
        throw error
      })
      .finally(() => {
        googleLoginInFlightRef.current = null
      })

    googleLoginInFlightRef.current = request

    return request
  }, [])

  // Facebook login using public_profile access token
  const loginWithFacebook = useCallback(async (accessToken, language) => {
    const authenticatedUser = await loginWithFacebookRequest(accessToken, language)
    setUser(authenticatedUser)
    setStatus('authenticated')
    return authenticatedUser
  }, [])

  const linkGoogleAccount = useCallback(async (credential) => {
    const updatedUser = await linkGoogleAccountRequest(credential)
    setUser(updatedUser)
    return updatedUser
  }, [])

  const linkFacebookAccount = useCallback(async (accessToken) => {
    const updatedUser = await linkFacebookAccountRequest(accessToken)
    setUser(updatedUser)
    return updatedUser
  }, [])

  const loginWithTelegram = useCallback(async (telegramUser, language) => {
    const authenticatedUser = await loginWithTelegramRequest(telegramUser, language)
    setUser(authenticatedUser)
    setStatus('authenticated')
    return authenticatedUser
  }, [])

  const requestPhoneCode = useCallback(
    async (phoneNumber) => requestPhoneCodeRequest(phoneNumber),
    [],
  )

  const verifyPhoneCode = useCallback(async ({ phoneNumber, code, language }) => {
    const authenticatedUser = await verifyPhoneCodeRequest({ phoneNumber, code, language })
    setUser(authenticatedUser)
    setStatus('authenticated')
    return authenticatedUser
  }, [])

  const loginWithEmail = useCallback(async ({ email, password, language }) => {
    const authenticatedUser = await loginWithEmailRequest({ email, password, language })
    setUser(authenticatedUser)
    setStatus('authenticated')
    return authenticatedUser
  }, [])

  const registerWithEmail = useCallback(async ({ email, password, displayName, language }) => {
    const authenticatedUser = await registerWithEmailRequest({ email, password, displayName, language })
    setUser(authenticatedUser)
    setStatus('authenticated')
    return authenticatedUser
  }, [])

  const logout = useCallback(async () => {
    await logoutRequest()
    setUser(null)
    setStatus('unauthenticated')
  }, [])

  const value = useMemo(
    () => ({
      user,
      status,
      googleClientId,
      facebookAppId,
      telegramBotUsername,
      loginWithGoogle,
      linkGoogleAccount,
      loginWithFacebook,
      linkFacebookAccount,
      loginWithTelegram,
      requestPhoneCode,
      verifyPhoneCode,
      loginWithEmail,
      registerWithEmail,
      logout,
    }),
    [
      user,
      status,
      googleClientId,
      facebookAppId,
      telegramBotUsername,
      loginWithGoogle,
      linkGoogleAccount,
      loginWithFacebook,
      linkFacebookAccount,
      loginWithTelegram,
      requestPhoneCode,
      verifyPhoneCode,
      loginWithEmail,
      registerWithEmail,
      logout,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
