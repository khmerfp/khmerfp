import { useLanguage } from '../../auth/LanguageContext.js'
import { LanguageToggle } from './LanguageToggle.jsx'

// share the sign-in and security page layout
export function AuthShell({ title, subtitle, children }) {
  const { text } = useLanguage()

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12 text-slate-900">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-emerald-700">
            Angkor Payment
          </p>
          <LanguageToggle />
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
          {title}
        </h1>
        {subtitle && <p className="mt-2 text-sm text-slate-500">{subtitle}</p>}

        <div className="mt-6 space-y-6">{children}</div>

        <p className="mt-6 text-center text-xs text-slate-500">
          <a href="/" className="hover:text-slate-700">
            {text.backToPayment}
          </a>
        </p>
      </div>
    </main>
  )
}
