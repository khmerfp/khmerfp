// show the validation result
export function SubmissionResult({ result }) {
  if (!result) return null

  const className = `rounded-lg border p-3 text-sm ${
    result.type === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-red-200 bg-red-50 text-red-700'
  }`

  if (result.type === 'error') {
    return (
      <div role="alert" className={className}>
        <span>{result.message}</span>
        {result.action && (
          <>
            {' '}
            <a href={result.action.href} className="font-semibold underline">
              {result.action.label}
            </a>
          </>
        )}
      </div>
    )
  }

  return (
    <output className={className}>
      {result.message}
    </output>
  )
}
