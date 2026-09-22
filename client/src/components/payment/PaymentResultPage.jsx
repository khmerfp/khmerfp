import { useEffect, useMemo, useRef, useState } from 'react'
import { getPaymentStatus } from '../../services/api.js'
import { createPaymentStatusPoller } from '../../services/paymentStatusPoller.js'
import { getPaymentResultPresentation } from '../../presentation/paymentResult.js'
import {
  getReturnTransactionId,
  loadStatusAccessToken,
} from '../../services/statusAccess.js'

// render a protected payment result page
export function PaymentResultPage({ cancelled = false }) {
  const transactionId = useMemo(
    () => getReturnTransactionId(window.location.search),
    [],
  )
  const token = useMemo(
    () => loadStatusAccessToken(transactionId),
    [transactionId],
  )
  const [state, setState] = useState(
    transactionId && token ? { kind: 'checking' } : { kind: 'missing_access' },
  )
  const pollerRef = useRef(null)

  useEffect(() => {
    if (!transactionId || !token) return undefined

    const poller = createPaymentStatusPoller({
      requestStatus: () => getPaymentStatus(transactionId, token),
      onState: setState,
    })
    pollerRef.current = poller
    poller.start()

    return () => {
      poller.stop()
      pollerRef.current = null
    }
  }, [token, transactionId])

  // manually refresh the protected status
  function refreshStatus() {
    void pollerRef.current?.refresh()
  }

  const presentation = getPaymentResultPresentation(state, cancelled)
  const showRefresh = ['checking', 'status', 'network_error', 'timeout'].includes(
    state.kind,
  ) && !['PAID', 'FAILED', 'CANCELLED'].includes(state.payment?.status)
  const statusClassName = {
    success: 'bg-emerald-50 text-emerald-700',
    error: 'bg-red-50 text-red-700',
    warning: 'bg-amber-50 text-amber-700',
    pending: 'bg-slate-100 text-slate-700',
  }[presentation.tone]

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-900 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-xl">
        <header className="mb-6">
          <p className="text-sm font-semibold text-emerald-700">ABA PayWay sandbox</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
            Payment status
          </h1>
        </header>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-6 sm:px-8">
            <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-semibold ${statusClassName}`}>
              {state.payment?.status ?? 'CHECKING'}
            </span>
            <h2 className="mt-4 text-xl font-semibold text-slate-950">
              {presentation.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {presentation.message}
            </p>
          </div>

          <div className="px-6 py-6 sm:px-8">

            {state.kind === 'network_error' && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                The network is temporarily unavailable. This does not mean payment failed.
              </p>
            )}
            {state.kind === 'timeout' && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Automatic checking stopped after one minute. This does not mean payment failed.
              </p>
            )}
            {state.payment && (
              <dl className="divide-y divide-slate-100 text-sm">
                <div className="flex items-center justify-between gap-6 py-3 first:pt-0">
                  <dt className="text-slate-500">Transaction</dt>
                  <dd className="break-all text-right font-mono text-slate-800">
                    {state.payment.tranId}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-6 py-3">
                  <dt className="text-slate-500">Amount</dt>
                  <dd className="text-right font-medium text-slate-900">
                    {state.payment.amount.toLocaleString()} {state.payment.currency}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-6 py-3 last:pb-0">
                  <dt className="text-slate-500">Status</dt>
                  <dd className="text-right font-medium text-slate-900">
                    {state.payment.status}
                  </dd>
                </div>
              </dl>
            )}

            <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-200 pt-5">
              {showRefresh && (
                <button
                  type="button"
                  onClick={refreshStatus}
                  className="rounded-lg bg-[#00b67a] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#009f6b] focus:outline-none focus:ring-2 focus:ring-[#00b67a] focus:ring-offset-2"
                >
                  Refresh status
                </button>
              )}
              <a
                href="/"
                className="inline-flex rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Return to form
              </a>
            </div>
          </div>
        </section>

        <p className="mt-5 text-center text-xs text-slate-500">
          Sandbox environment · Status is verified by the backend
        </p>
      </div>
    </main>
  )
}
