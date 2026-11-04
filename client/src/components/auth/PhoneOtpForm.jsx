import { useState } from 'react'
import { useApp } from '../../state/AppContext.jsx'
import { useAuth } from '../../auth/authContext.js'
import { T } from '../../lib/i18n.js'

const inputClassName =
  'mt-1.5 h-11 w-full rounded-xl border border-[#D0D5DD] dark:border-[#344054] bg-white dark:bg-[#0B1016] px-3.5 text-sm text-[#101828] dark:text-[#F2F4F7] placeholder:text-[#98A2B3] outline-none transition hover:border-[#98A2B3] dark:hover:border-[#475467] focus:border-[#33C7A6] focus:ring-2 focus:ring-[#33C7A6]/20 disabled:cursor-not-allowed disabled:opacity-60'

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
  const [devCode, setDevCode] = useState(null)
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
      const result = await requestPhoneCode(normalized)
      setPhoneNumber(normalized)
      setDevCode(result?.devCode ?? null)
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

        {devCode && (
          <p className="text-xs rounded-lg border border-[#33C7A6]/40 bg-[#33C7A6]/10 px-3 py-2 text-[#0A0E14] dark:text-white">
            {t.devCodeNotice(devCode)}
          </p>
        )}

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
          className="w-full mt-2 min-h-11 py-2.5 rounded-xl font-semibold text-[#07110F] bg-[#33C7A6] transition hover:bg-[#45D4B4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#33C7A6]/50 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#0F141B] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? t.verifyingCode : t.verifyCode}
        </button>

        <button
          type="button"
          onClick={() => {
            setStep('phone')
            setCode('')
            setDevCode(null)
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
        className="w-full mt-2 min-h-11 py-2.5 rounded-xl font-semibold text-[#07110F] bg-[#33C7A6] transition hover:bg-[#45D4B4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#33C7A6]/50 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#0F141B] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? t.sendingCode : t.sendCode}
      </button>
    </form>
  )
}
