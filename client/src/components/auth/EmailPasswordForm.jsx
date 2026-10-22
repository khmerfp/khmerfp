import { useState } from 'react'
import { useApp } from '../../state/AppContext.jsx'

const inputClassName =
  'mt-1 w-full rounded-lg border border-[#E4E7EC] dark:border-[#212832] bg-[#F4F6F8] dark:bg-[#0A0E14] px-3 py-2 text-sm outline-none focus:border-[#33C7A6]/60'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_MIN_LENGTH = 8

function validate({ email, password, confirmPassword, mode }) {
  const errors = {}
  if (!email.trim()) {
    errors.email = 'fillAllFields'
  } else if (!EMAIL_PATTERN.test(email.trim())) {
    errors.email = 'invalidLogin'
  }
  if (!password) {
    errors.password = 'fillAllFields'
  } else if (password.length < PASSWORD_MIN_LENGTH) {
    errors.password = 'fillAllFields'
  }
  if (mode === 'register' && confirmPassword !== password) {
    errors.confirmPassword = 'fillAllFields'
  }
  return errors
}

export function EmailPasswordForm({ onSignIn, onRegister }) {
  const { lang } = useApp()
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [formError, setFormError] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    if (isSubmitting) return

    const errors = validate({ email, password, confirmPassword, mode })
    setFormError(null)

    if (Object.keys(errors).length > 0) return

    setIsSubmitting(true)

    try {
      const payload = { email: email.trim(), password, language: lang }
      if (mode === 'register') {
        await onRegister(payload)
      } else {
        await onSignIn(payload)
      }
    } catch (error) {
      setFormError(error?.message || 'Sign-in failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  const isRegister = mode === 'register'

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-3">
      <div>
        <label className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">Email</label>
        <input
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
            setFormError(null)
          }}
          disabled={isSubmitting}
          className={inputClassName}
        />
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">Password</label>
        <input
          type="password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
            setFormError(null)
          }}
          disabled={isSubmitting}
          className={inputClassName}
        />
      </div>

      {isRegister && (
        <div>
          <label className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">Confirm Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => {
              setConfirmPassword(event.target.value)
              setFormError(null)
            }}
            disabled={isSubmitting}
            className={inputClassName}
          />
        </div>
      )}

      {formError && <p className="text-xs text-[#E15A4D]">{formError}</p>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full mt-2 py-2.5 rounded-lg font-semibold text-[#0A0E14] bg-[#33C7A6] disabled:opacity-60"
      >
        {isRegister ? 'Create account' : 'Log in'}
      </button>

      <button
        type="button"
        onClick={() => resetFields(isRegister ? 'signin' : 'register')}
        className="w-full text-xs text-[#5B6472] dark:text-[#7C8697]"
      >
        {isRegister ? 'Already have an account? Log in' : "Don't have an account? Register"}
      </button>
    </form>
  )

  function resetFields(nextMode) {
    setMode(nextMode)
    setFormError(null)
  }
}
