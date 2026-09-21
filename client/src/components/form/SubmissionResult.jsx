export function SubmissionResult({ result }) {
  if (!result) return null

  return (
    <div
      role={result.type === 'error' ? 'alert' : 'status'}
      className={`rounded-xl border p-4 text-sm ${
        result.type === 'success'
          ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
          : 'border-rose-400/30 bg-rose-400/10 text-rose-200'
      }`}
    >
      {result.message}
    </div>
  )
}

