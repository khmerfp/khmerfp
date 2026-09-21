import { PaymentForm } from './components/payment/PaymentForm.jsx'
import { ProjectSummary } from './components/ProjectSummary.jsx'

function App() {
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white sm:px-6 sm:py-12">
      <div className="mx-auto grid w-full max-w-5xl gap-8 lg:grid-cols-[0.85fr_1.15fr]">
        <ProjectSummary />
        <PaymentForm />
      </div>
    </main>
  )
}

export default App
