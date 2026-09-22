// show the validation result
export function SubmissionResult({ result }) {
  if (!result) return null

  return (
    <div
      role={result.type === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border p-3 text-sm ${
        result.type === 'success'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
          : 'border-red-200 bg-red-50 text-red-700'
      }`}
    >
      {result.message}
    </div>
  )
}
