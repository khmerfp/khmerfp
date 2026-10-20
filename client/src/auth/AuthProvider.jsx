import { useCallback, useEffect, useMemo, useState } from 'react'
import { AuthContext } from './authContext.js'
import {
  getAuthConfig,
  getCurrentUser,
  loginWithGoogle as loginWithGoogleRequest,
  loginWithFacebook as loginWithFacebookRequest,
  loginWithTelegram as loginWithTelegramRequest,
  requestPhoneCode as requestPhoneCodeRequest,
  verifyPhoneCode as verifyPhoneCodeRequest,
  loginWithEmail as loginWithEmailRequest,
  registerWithEmail as registerWithEmailRequest,
  logout as logoutRequest,
} from '../services/authApi.js'

// hold session state for the whole application
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('loading')
  const [googleClientId, setGoogleClientId] = useState(null)
  const [facebookAppId, setFacebookAppId] = useState(null)
  const [telegramBotUsername, setTelegramBotUsername] = useState(null)

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

  const loginWithGoogle = useCallback(async (credential, language) => {
    const authenticatedUser = await loginWithGoogleRequest(credential, language)

    setUser(authenticatedUser)
    setStatus('authenticated')

    return authenticatedUser
  }, [])

  const loginWithFacebook = useCallback(async (accessToken, language) => {
    const authenticatedUser = await loginWithFacebookRequest(accessToken, language)

    setUser(authenticatedUser)
    setStatus('authenticated')

    return authenticatedUser
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

  const verifyPhoneCode = useCallback(
    async ({ phoneNumber, code, language }) => {
      const authenticatedUser = await verifyPhoneCodeRequest({
        phoneNumber,
        code,
        language,
      })

      setUser(authenticatedUser)
      setStatus('authenticated')

      return authenticatedUser
    },
    [],
  )

  const loginWithEmail = useCallback(async ({ email, password, language }) => {
    const authenticatedUser = await loginWithEmailRequest({
      email,
      password,
      language,
    })

    setUser(authenticatedUser)
    setStatus('authenticated')

    return authenticatedUser
  }, [])

  const registerWithEmail = useCallback(
    async ({ email, password, displayName, language }) => {
      const authenticatedUser = await registerWithEmailRequest({
        email,
        password,
        displayName,
        language,
      })

      setUser(authenticatedUser)
      setStatus('authenticated')

      return authenticatedUser
    },
    [],
  )

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
      loginWithFacebook,
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
      loginWithFacebook,
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
