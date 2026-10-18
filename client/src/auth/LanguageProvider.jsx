import { useCallback, useMemo, useState } from 'react'
import { LanguageContext } from './LanguageContext.js'
import { AUTH_TEXT, readStoredLanguage } from '../i18n/authText.js'

const LANGUAGE_STORAGE_KEY = 'angkor_language'

// hold the EN/KM choice for the whole application
export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(readStoredLanguage)

  const setLanguage = useCallback((next) => {
    const normalized = next === 'km' ? 'km' : 'en'
    setLanguageState(normalized)

    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized)
    } catch {
      // private browsing without storage still keeps the in-memory choice
    }
  }, [])

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      text: AUTH_TEXT[language],
    }),
    [language, setLanguage],
  )

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  )
}
