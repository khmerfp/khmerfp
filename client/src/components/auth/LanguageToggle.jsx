import { useLanguage } from '../../auth/LanguageContext.js'

// small EN/KM switcher rendered on the auth and security screens
export function LanguageToggle() {
  const { language, setLanguage } = useLanguage()

  return (
    <div
      className="flex items-center gap-1 rounded-full border border-slate-200 bg-white p-0.5 text-xs font-medium"
      role="group"
      aria-label="Language"
    >
      {['en', 'km'].map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLanguage(code)}
          aria-pressed={language === code}
          className={
            language === code
              ? 'rounded-full bg-emerald-600 px-2.5 py-1 text-white'
              : 'rounded-full px-2.5 py-1 text-slate-600 hover:bg-slate-50'
          }
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
