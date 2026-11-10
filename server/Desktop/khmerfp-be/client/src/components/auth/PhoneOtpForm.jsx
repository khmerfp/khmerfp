import { useState } from 'react'
import { useApp } from '../../state/AppContext.jsx'
import { useAuth } from '../../auth/authContext.js'
import { T } from '../../lib/i18n.js'

const inputClassName =
  'mt-1 w-full rounded-lg border border-[#E4E7EC] dark:border-[#212832] bg-[#F4F6F8] dark:bg-[#0A0E14] px-3 py-2 text-sm outline-none focus:border-[#33C7A6]/60'

const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/

function normalizePhone(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/[^\d]/g, '')
  if (!hasPlus || digits.length < 7 || digits.length > 15) return null
  return `+${digits}`
}

export function PhoneOtpForm({ onAuthenticated }) {
  const { lang } = useApp()
  const t = T[lang]
  const { requestPhoneCode, verifyPhoneCode } = useAuth()

  const [step, setStep] = useState('phone')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleRequestCode(event) {
    event.preventDefault()
    if (isSubmitting) return

    const normalized = normalizePhone(phoneNumber)
    if (!normalized || !PHONE_PATTERN.test(normalized)) {
      setError(t.invalidPhone)
      return
    }

    setError(null)
    setIsSubmitting(true)

    try {
      await requestPhoneCode(normalized)
      setPhoneNumber(normalized)
      setStep('code')
    } catch (err) {
      setError(err?.message || t.invalidPhone)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleVerifyCode(event) {
    event.preventDefault()
    if (isSubmitting) return

    if (!/^\d{4,8}$/.test(code.trim())) {
      setError(t.fillAllFields)
      return
    }

    setError(null)
    setIsSubmitting(true)

    try {
      const user = await verifyPhoneCode({ phoneNumber, code: code.trim(), language: lang })
      onAuthenticated?.(user)
    } catch (err) {
      setError(err?.message || t.fillAllFields)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (step === 'code') {
    return (
      <form onSubmit={(event) => void handleVerifyCode(event)} noValidate className="space-y-3">
        <p className="text-xs text-[#5B6472] dark:text-[#7C8697]">{t.codeSentTo(phoneNumber)}</p>

        <div>
          <label className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">{t.verificationCode}</label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/[^\d]/g, '').slice(0, 8))
              setError(null)
            }}
            disabled={isSubmitting}
            className={`${inputClassName} tracking-[0.3em]`}
          />
        </div>

        {error && <p className="text-xs text-[#E15A4D]">{error}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full mt-2 py-2.5 rounded-lg font-semibold text-[#0A0E14] bg-[#33C7A6] disabled:opacity-60"
        >
          {isSubmitting ? t.verifyingCode : t.verifyCode}
        </button>

        <button
          type="button"
          onClick={() => {
            setStep('phone')
            setCode('')
            setError(null)
          }}
          className="w-full text-xs text-[#5B6472] dark:text-[#7C8697]"
        >
          {t.changePhoneNumber}
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={(event) => void handleRequestCode(event)} noValidate className="space-y-3">
      <div>
        <label className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">{t.phoneNumberLabel}</label>
        <input
          type="tel"
          autoComplete="tel"
          placeholder={t.phonePlaceholder}
          value={phoneNumber}
          onChange={(event) => {
            setPhoneNumber(event.target.value)
            setError(null)
          }}
          disabled={isSubmitting}
          className={inputClassName}
        />
      </div>

      {error && <p className="text-xs text-[#E15A4D]">{error}</p>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full mt-2 py-2.5 rounded-lg font-semibold text-[#0A0E14] bg-[#33C7A6] disabled:opacity-60"
      >
        {isSubmitting ? t.sendingCode : t.sendCode}
      </button>
    </form>
  )
}
