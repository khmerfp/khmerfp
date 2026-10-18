import { useCallback, useEffect, useMemo, useState } from 'react'
import { AuthContext } from './authContext.js'
import {
  getAuthConfig,
  getCurrentUser,
  loginWithGoogle as loginWithGoogleRequest,
  logout as logoutRequest,
} from '../services/authApi.js'

// hold session state for the whole application
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('loading')
  const [googleClientId, setGoogleClientId] = useState(null)
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
      telegramBotUsername,
      loginWithGoogle,
      logout,
    }),
    [
      user,
      status,
      googleClientId,
      telegramBotUsername,
      loginWithGoogle,
      logout,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
