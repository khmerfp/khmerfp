import { createContext, useContext } from 'react'

export const AuthContext = createContext(null)

// read the current session state
export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider.')
  }

  return context
}
