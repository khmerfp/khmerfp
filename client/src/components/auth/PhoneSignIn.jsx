import { useState } from 'react'
import { useLanguage } from '../../auth/LanguageContext.js'

const inputClassName =
  'mt-2 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-base text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500'

const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/
const CODE_PATTERN = /^\d{4,8}$/

// two-step phone sign-in: request an SMS code, then redeem it
export function PhoneSignIn({ onRequestCode, onVerifyCode }) {
  const { language, text } = useLanguage()
  const [step, setStep] = useState('phone')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [code, setCode] = useState('')
  const [fieldError, setFieldError] = useState(null)
  const [formError, setFormError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleRequest(event) {
    event.preventDefault()

    if (isSubmitting) return

    const trimmed = phoneNumber.trim()

    if (!PHONE_PATTERN.test(trimmed)) {
      setFieldError('invalidPhone')
      return
    }

    setFieldError(null)
    setFormError(null)
    setIsSubmitting(true)

    try {
      await onRequestCode(trimmed)
      setStep('code')
      setNotice(text.phoneCodeSent)
    } catch (error) {
      setFormError(error?.message || text.signInFailed)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleVerify(event) {
    event.preventDefault()

    if (isSubmitting) return

    if (!CODE_PATTERN.test(code.trim())) {
      setFieldError('invalidCode')
      return
    }

    setFieldError(null)
    setFormError(null)
    setIsSubmitting(true)

    try {
      await onVerifyCode({ phoneNumber: phoneNumber.trim(), code: code.trim(), language })
    } catch (error) {
      setFormError(error?.message || text.signInFailed)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (step === 'code') {
    return (
      <form onSubmit={(event) => void handleVerify(event)} noValidate>
        <div>
          <label htmlFor="auth-phone-code" className="block text-sm font-medium text-slate-700">
            {text.phoneCodeLabel}
          </label>
          <input
            id="auth-phone-code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            value={code}
            onChange={(event) => {
              setCode(event.target.value)
              setFieldError(null)
              setFormError(null)
            }}
            disabled={isSubmitting}
            aria-invalid={Boolean(fieldError)}
            className={inputClassName}
            placeholder="123456"
          />
          {fieldError && (
            <p className="mt-1.5 text-sm text-red-600">{text[fieldError]}</p>
          )}
        </div>

        {notice && !formError && (
          <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {notice}
          </p>
        )}

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
          {isSubmitting ? text.verifying : text.verifyCode}
        </button>

        <p className="mt-4 text-center text-sm text-slate-500">
          <button
            type="button"
            onClick={() => {
              setStep('phone')
              setCode('')
              setNotice(null)
              setFormError(null)
              setFieldError(null)
            }}
            disabled={isSubmitting}
            className="font-medium text-emerald-700 hover:text-emerald-800 hover:underline disabled:opacity-60"
          >
            {text.useAnotherNumber}
          </button>
        </p>
      </form>
    )
  }

  return (
    <form onSubmit={(event) => void handleRequest(event)} noValidate>
      <div>
        <label htmlFor="auth-phone" className="block text-sm font-medium text-slate-700">
          {text.phoneLabel}
        </label>
        <input
          id="auth-phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          maxLength={17}
          value={phoneNumber}
          onChange={(event) => {
            setPhoneNumber(event.target.value)
            setFieldError(null)
            setFormError(null)
          }}
          disabled={isSubmitting}
          aria-invalid={Boolean(fieldError)}
          className={inputClassName}
          placeholder={text.phonePlaceholder}
        />
        {fieldError && (
          <p className="mt-1.5 text-sm text-red-600">{text[fieldError]}</p>
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
        {isSubmitting ? text.sendingCode : text.sendCode}
      </button>
    </form>
  )
}
