import { useBackendHealth } from '../hooks/useBackendHealth.js'

const healthStates = {
  checking: { label: 'Checking server…', dotClass: 'bg-amber-500' },
  connected: { label: 'Server online', dotClass: 'bg-emerald-500' },
  unavailable: { label: 'Server unavailable', dotClass: 'bg-red-500' },
}

// show the current backend state
export function BackendStatus() {
  const health = useBackendHealth()
  const state = healthStates[health]

  return (
    <div className="flex items-center gap-2 text-sm text-slate-600" aria-live="polite">
      <span className={`h-2 w-2 rounded-full ${state.dotClass}`} />
      <span>{state.label}</span>
    </div>
  )
}
