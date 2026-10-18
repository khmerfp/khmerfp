import { createContext, useContext } from 'react'

export const LanguageContext = createContext(null)

// read the active interface language
export function useLanguage() {
  const context = useContext(LanguageContext)

  if (!context) {
    throw new Error('useLanguage must be used inside LanguageProvider.')
  }

  return context
}
