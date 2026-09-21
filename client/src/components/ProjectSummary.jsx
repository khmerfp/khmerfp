import { BackendStatus } from './BackendStatus.jsx'

// show the project summary panel
export function ProjectSummary() {
  return (
    <section className="flex flex-col justify-between rounded-3xl border border-white/10 bg-gradient-to-br from-emerald-400/15 to-blue-500/10 p-7 sm:p-10">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-emerald-300">
          ABA PayWay project
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
          PayWay Payment
        </h1>
        <p className="mt-5 leading-7 text-slate-300">
          Prepare a test transaction and continue to ABA PayWay hosted checkout in the
          sandbox environment.
        </p>
      </div>

      <div className="mt-10 rounded-2xl border border-amber-300/25 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100">
        <strong className="font-semibold">
          Sandbox only. Payment verification is not implemented.
        </strong>
        <p className="mt-1">Browser return pages never mark a transaction as paid.</p>
      </div>

      <BackendStatus />
    </section>
  )
}
