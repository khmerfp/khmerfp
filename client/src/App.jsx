import { AuthProvider } from './auth/AuthProvider.jsx'
import { LanguageProvider } from './auth/LanguageProvider.jsx'
import { PaymentForm } from './components/payment/PaymentForm.jsx'
import { PaymentResultPage } from './components/payment/PaymentResultPage.jsx'
import { ProjectSummary } from './components/ProjectSummary.jsx'
import { LoginPage } from './pages/LoginPage.jsx'
import { SecurityPage } from './pages/SecurityPage.jsx'

// render the main payment page
function App() {
  let page

  if (window.location.pathname === '/login') {
    page = <LoginPage />
  } else if (window.location.pathname === '/register') {
    // accounts are created by Google sign-in; keep old links working
    window.location.replace('/login')
    page = null
  } else if (window.location.pathname === '/security') {
    page = <SecurityPage />
  } else if (window.location.pathname === '/payment/result') {
    page = <PaymentResultPage />
  } else if (window.location.pathname === '/payment/cancel') {
    page = <PaymentResultPage cancelled />
  } else {
    page = (
      <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900 sm:px-6 sm:py-12">
        <div className="mx-auto w-full max-w-4xl">
          <ProjectSummary />
          <PaymentForm />
          <p className="mt-5 text-center text-xs text-slate-500">
            Sandbox environment · Test payments only · No real funds will be transferred
          </p>
        </div>
      </main>
    )
  }

  return (
    <LanguageProvider>
      <AuthProvider>{page}</AuthProvider>
    </LanguageProvider>
  )
}

export default App
