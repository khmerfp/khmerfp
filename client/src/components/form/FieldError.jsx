// show one field error
export function FieldError({ id, message }) {
  if (!message) return null

  return (
    <p id={id} className="mt-2 text-sm text-rose-300">
      {message}
    </p>
  )
}
