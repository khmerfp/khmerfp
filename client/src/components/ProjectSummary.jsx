import { BackendStatus } from './BackendStatus.jsx'
import { UserMenu } from './auth/UserMenu.jsx'

// show the project summary panel
export function ProjectSummary() {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-xl">
        <p className="text-sm font-semibold text-emerald-700">
          Angkor Payment
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
          Make a payment
        </h1>
      </div>
      <div className="flex items-center gap-4">
        <BackendStatus />
        <UserMenu />
      </div>
    </header>
  )
}
