import { useState } from 'react'
import { useApp } from '../../state/AppContext.jsx'
import { T } from '../../lib/i18n.js'

const inputClassName =
  'mt-1 w-full rounded-lg border border-[#E4E7EC] dark:border-[#212832] bg-[#F4F6F8] dark:bg-[#0A0E14] px-3 py-2 text-sm outline-none focus:border-[#33C7A6]/60'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_MIN_LENGTH = 8

function validate({ email, password, confirmPassword, mode }) {
  const errors = {}
  const trimmedEmail = email.trim()

  if (!trimmedEmail) {
    errors.email = 'fillAllFields'
  } else if (!EMAIL_PATTERN.test(trimmedEmail)) {
    errors.email = 'invalidEmail'
  }

  if (!password) {
    errors.password = 'fillAllFields'
  } else if (password.length < PASSWORD_MIN_LENGTH) {
    errors.password = 'passwordTooShort'
  }

  if (mode === 'register' && confirmPassword !== password) {
    errors.confirmPassword = 'passwordsDoNotMatch'
  }

  return errors
}

export function EmailPasswordForm({ mode = 'login', onModeChange, onSignIn, onRegister }) {
  const { lang } = useApp()
  const t = T[lang]
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isRegister = mode === 'register'

  async function handleSubmit(event) {
    event.preventDefault()
    if (isSubmitting) return

    const errors = validate({ email, password, confirmPassword, mode })
    setFormError(null)
    setFieldErrors(errors)

    if (Object.keys(errors).length > 0) return

    setIsSubmitting(true)

    try {
      const payload = { email: email.trim(), password, language: lang }
      if (isRegister) {
        await onRegister(payload)
      } else {
        await onSignIn(payload)
      }
    } catch (error) {
      setFormError(error?.message || t.invalidLogin)
    } finally {
      setIsSubmitting(false)
    }
  }

  function switchMode() {
    setFormError(null)
    setFieldErrors({})
    setPassword('')
    setConfirmPassword('')
    onModeChange?.(isRegister ? 'login' : 'register')
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-3">
      <div>
        <label className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">{t.email}</label>
        <input
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
            setFieldErrors((current) => ({ ...current, email: undefined }))
            setFormError(null)
          }}
          disabled={isSubmitting}
          className={inputClassName}
        />
        {fieldErrors.email && <p className="mt-1 text-xs text-[#E15A4D]">{t[fieldErrors.email]}</p>}
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">{t.password}</label>
        <input
          type="password"
          name="password"
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
            setFieldErrors((current) => ({ ...current, password: undefined }))
            setFormError(null)
          }}
          disabled={isSubmitting}
          className={inputClassName}
        />
        {fieldErrors.password && <p className="mt-1 text-xs text-[#E15A4D]">{t[fieldErrors.password]}</p>}
      </div>

      {isRegister && (
        <div>
          <label className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">{t.confirmPassword}</label>
          <input
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => {
              setConfirmPassword(event.target.value)
              setFieldErrors((current) => ({ ...current, confirmPassword: undefined }))
              setFormError(null)
            }}
            disabled={isSubmitting}
            className={inputClassName}
          />
          {fieldErrors.confirmPassword && <p className="mt-1 text-xs text-[#E15A4D]">{t[fieldErrors.confirmPassword]}</p>}
        </div>
      )}

      {formError && <p className="text-xs text-[#E15A4D]">{formError}</p>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full mt-2 py-2.5 rounded-lg font-semibold text-[#0A0E14] bg-[#33C7A6] disabled:opacity-60"
      >
        {isRegister
          ? isSubmitting
            ? t.creatingAccount
            : t.createAccountBtn
          : t.logInBtn}
      </button>

      <button
        type="button"
        onClick={switchMode}
        className="w-full rounded-lg py-2 text-xs font-semibold text-[#3568F4] dark:text-[#7EA0FF] transition-colors hover:bg-[#4F7CFF]/10 hover:text-[#2456DB] dark:hover:text-[#A7BCFF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7CFF]/50"
      >
        {isRegister ? t.switchToLogin : t.switchToRegister}
      </button>
    </form>
  )
}
