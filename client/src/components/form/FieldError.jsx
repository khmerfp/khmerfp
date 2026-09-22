// show one field error
export function FieldError({ id, message }) {
  if (!message) return null

  return (
    <p id={id} className="mt-1.5 text-sm text-red-600">
      {message}
    </p>
  )
}
