// show a temporary checkout return notice
export function CheckoutNotice({ cancelled = false }) {
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-16 text-white">
      <section className="mx-auto max-w-xl rounded-3xl border border-amber-300/25 bg-white/[0.06] p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-300">
          PayWay sandbox
        </p>
        <h1 className="mt-4 text-3xl font-bold">
          {cancelled ? 'Checkout cancelled or closed' : 'Returned from checkout'}
        </h1>
        <p className="mt-4 leading-7 text-slate-300">
          Payment verification is not implemented yet. This page does not mark any
          transaction as paid, failed, or cancelled.
        </p>
        <a
          href="/"
          className="mt-7 inline-flex rounded-xl bg-emerald-400 px-5 py-3 font-semibold text-slate-950"
        >
          Return to form
        </a>
      </section>
    </main>
  )
}
