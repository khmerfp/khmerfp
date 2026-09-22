import { BackendStatus } from './BackendStatus.jsx'

// show the project summary panel
export function ProjectSummary() {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-xl">
        <p className="text-sm font-semibold text-emerald-700">
          ABA PayWay sandbox
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
          Make a test payment
        </h1>
      </div>
      <BackendStatus />
    </header>
  )
}
