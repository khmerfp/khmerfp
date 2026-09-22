import { PaymentForm } from './components/payment/PaymentForm.jsx'
import { PaymentResultPage } from './components/payment/PaymentResultPage.jsx'
import { ProjectSummary } from './components/ProjectSummary.jsx'

// render the main payment page
function App() {
  if (window.location.pathname === '/payment/result') {
    return <PaymentResultPage />
  }

  if (window.location.pathname === '/payment/cancel') {
    return <PaymentResultPage cancelled />
  }

  return (
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

export default App
