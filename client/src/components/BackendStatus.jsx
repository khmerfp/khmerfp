import { useBackendHealth } from '../hooks/useBackendHealth.js'

const healthStates = {
  checking: { label: 'Checking backend…', dotClass: 'bg-amber-400' },
  connected: { label: 'Backend connected', dotClass: 'bg-emerald-400' },
  unavailable: { label: 'Backend unavailable', dotClass: 'bg-rose-400' },
}

export function BackendStatus() {
  const health = useBackendHealth()
  const state = healthStates[health]

  return (
    <div className="mt-6 flex items-center gap-2 text-sm text-slate-300" aria-live="polite">
      <span className={`h-2.5 w-2.5 rounded-full ${state.dotClass}`} />
      <span>{state.label}</span>
    </div>
  )
}

