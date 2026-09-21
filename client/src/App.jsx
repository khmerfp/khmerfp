import { useEffect, useState } from 'react'

const healthStates = {
  checking: {
    label: 'Checking backend connection…',
    dotClass: 'bg-amber-400',
    textClass: 'text-amber-200',
  },
  connected: {
    label: 'Backend connected',
    dotClass: 'bg-emerald-400',
    textClass: 'text-emerald-200',
  },
  unavailable: {
    label: 'Backend unavailable',
    dotClass: 'bg-rose-400',
    textClass: 'text-rose-200',
  },
}

async function getBackendHealth() {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch('/api/health', {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    const body = await response.json()
    return response.ok && body.status === 'ok' ? 'connected' : 'unavailable'
  } catch {
    return 'unavailable'
  } finally {
    window.clearTimeout(timeout)
  }
}

function App() {
  const [health, setHealth] = useState('checking')

  useEffect(() => {
    getBackendHealth().then(setHealth)
  }, [])

  const state = healthStates[health]

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-6 py-12 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.16),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.14),transparent_34%)]" />

      <section className="relative w-full max-w-2xl rounded-3xl border border-white/10 bg-white/[0.06] p-8 shadow-2xl shadow-black/30 backdrop-blur sm:p-12">
        <div className="mb-10 inline-flex items-center rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-sm font-medium text-amber-100">
          Payment integration not connected
        </div>

        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.24em] text-emerald-300">
          ABA PayWay project
        </p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
          PayWay Payment
        </h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
          The application foundation is ready. Payment collection, PayWay checkout,
          and MongoDB persistence will be added in later reviewed steps.
        </p>

        <div className="mt-10 rounded-2xl border border-white/10 bg-slate-900/70 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                Service status
              </p>
              <div className="mt-2 flex items-center gap-2" aria-live="polite">
                <span className={`h-2.5 w-2.5 rounded-full ${state.dotClass}`} />
                <span className={`font-medium ${state.textClass}`}>{state.label}</span>
              </div>
              {health === 'unavailable' && (
                <p className="mt-2 text-sm text-slate-400">
                  Start the backend on port 3000, then try again.
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setHealth('checking')
                getBackendHealth().then(setHealth)
              }}
              disabled={health === 'checking'}
              className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-emerald-300 disabled:cursor-wait disabled:opacity-60"
            >
              Check connection
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}

export default App
