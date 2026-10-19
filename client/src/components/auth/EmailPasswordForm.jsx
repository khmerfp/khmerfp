import { useState } from 'react'
import { useLanguage } from '../../auth/LanguageContext.js'

const inputClassName =
  'mt-2 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-base text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_MIN_LENGTH = 8

function validate({ email, password, confirmPassword, mode }) {
  const errors = {}

  if (!email.trim()) {
    errors.email = 'fieldRequired'
  } else if (!EMAIL_PATTERN.test(email.trim())) {
    errors.email = 'invalidEmail'
  }

  if (!password) {
    errors.password = 'fieldRequired'
  } else if (password.length < PASSWORD_MIN_LENGTH) {
    errors.password = 'passwordMinLength'
  }

  if (mode === 'register' && confirmPassword !== password) {
    errors.confirmPassword = 'passwordMismatch'
  }

  return errors
}

// email and password sign-in / registration form
export function EmailPasswordForm({ onSignIn, onRegister }) {
  const { language, text } = useLanguage()
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  function resetFields(nextMode) {
    setMode(nextMode)
    setFieldErrors({})
    setFormError(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()

    if (isSubmitting) return

    const errors = validate({ email, password, confirmPassword, mode })
    setFieldErrors(errors)
    setFormError(null)

    if (Object.keys(errors).length > 0) return

    setIsSubmitting(true)

    try {
      const payload = { email: email.trim(), password, language }

      if (mode === 'register') {
        await onRegister(payload)
      } else {
        await onSignIn(payload)
      }
    } catch (error) {
      setFormError(error?.message || text.emailSignInFailed)
    } finally {
      setIsSubmitting(false)
    }
  }

  const isRegister = mode === 'register'

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate>
      <div className="space-y-4">
        <div>
          <label
            htmlFor="auth-email"
            className="block text-sm font-medium text-slate-700"
          >
            {text.emailLabel}
          </label>
          <input
            id="auth-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={320}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setFieldErrors((current) => ({ ...current, email: undefined }))
              setFormError(null)
            }}
            disabled={isSubmitting}
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? 'auth-email-error' : undefined}
            className={inputClassName}
            placeholder={text.emailPlaceholder}
          />
          {fieldErrors.email && (
            <p
              id="auth-email-error"
              className="mt-1.5 text-sm text-red-600"
            >
              {text[fieldErrors.email]}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="auth-password"
            className="block text-sm font-medium text-slate-700"
          >
            {text.passwordLabel}
          </label>
          <input
            id="auth-password"
            name="password"
            type="password"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            maxLength={200}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              setFieldErrors((current) => ({
                ...current,
                password: undefined,
              }))
              setFormError(null)
            }}
            disabled={isSubmitting}
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={
              fieldErrors.password ? 'auth-password-error' : undefined
            }
            className={inputClassName}
            placeholder={text.passwordPlaceholder}
          />
          {fieldErrors.password && (
            <p
              id="auth-password-error"
              className="mt-1.5 text-sm text-red-600"
            >
              {text[fieldErrors.password]}
            </p>
          )}
        </div>

        {isRegister && (
          <div>
            <label
              htmlFor="auth-confirm-password"
              className="block text-sm font-medium text-slate-700"
            >
              {text.passwordLabel}
            </label>
            <input
              id="auth-confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              maxLength={200}
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value)
                setFieldErrors((current) => ({
                  ...current,
                  confirmPassword: undefined,
                }))
                setFormError(null)
              }}
              disabled={isSubmitting}
              aria-invalid={Boolean(fieldErrors.confirmPassword)}
              aria-describedby={
                fieldErrors.confirmPassword
                  ? 'auth-confirm-password-error'
                  : undefined
              }
              className={inputClassName}
              placeholder={text.passwordPlaceholder}
            />
            {fieldErrors.confirmPassword && (
              <p
                id="auth-confirm-password-error"
                className="mt-1.5 text-sm text-red-600"
              >
                {text[fieldErrors.confirmPassword]}
              </p>
            )}
          </div>
        )}
      </div>

      {formError && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-5 w-full rounded-lg bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
      >
        {isSubmitting
          ? isRegister
            ? text.registering
            : text.signingIn
          : isRegister
            ? text.submitRegister
            : text.submitSignIn}
      </button>

      <p className="mt-4 text-center text-sm text-slate-500">
        {isRegister ? text.alreadyHaveAccount : text.noAccountYet}{' '}
        <button
          type="button"
          onClick={() => resetFields(isRegister ? 'signin' : 'register')}
          disabled={isSubmitting}
          className="font-medium text-emerald-700 hover:text-emerald-800 hover:underline disabled:opacity-60"
        >
          {isRegister ? text.switchToSignIn : text.switchToRegister}
        </button>
      </p>
    </form>
  )
}
