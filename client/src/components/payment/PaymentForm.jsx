import { useState } from 'react'
import {
  ACCOUNT_NUMBER_MAX_LENGTH,
  INITIAL_PAYMENT_FORM,
  NAME_MAX_LENGTH,
} from '../../config/payment.js'
import {
  getApiErrorMessage,
  validatePaymentDetails,
} from '../../services/api.js'
import { validatePaymentForm } from '../../validation/paymentForm.js'
import { FieldError } from '../form/FieldError.jsx'
import { SubmissionResult } from '../form/SubmissionResult.jsx'

const inputClassName =
  'mt-2 w-full rounded-xl border border-white/15 bg-slate-900/80 px-4 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 disabled:opacity-60'

// render the payment details form
export function PaymentForm() {
  const [form, setForm] = useState(INITIAL_PAYMENT_FORM)
  const [fieldErrors, setFieldErrors] = useState({})
  const [result, setResult] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // update one form field
  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setFieldErrors((current) => ({ ...current, [name]: undefined }))
    setResult(null)
  }

  // validate and submit the details
  async function handleSubmit(event) {
    event.preventDefault()
    if (isSubmitting) return

    const validation = validatePaymentForm(form)
    if (!validation.isValid) {
      setFieldErrors(validation.errors)
      setResult(null)
      return
    }

    setIsSubmitting(true)
    setFieldErrors({})
    setResult(null)

    try {
      const response = await validatePaymentDetails(validation.data)

      if (!response.ok) {
        if (response.status === 400 && response.errors && typeof response.errors === 'object') {
          setFieldErrors(response.errors)
          setResult({ type: 'error', message: 'Please correct the highlighted details.' })
        } else {
          setResult({
            type: 'error',
            message: response.message || 'The details could not be validated. Please try again.',
          })
        }
        return
      }

      setResult({
        type: 'success',
        message: 'Details validated. No payment has been initiated.',
      })
    } catch (error) {
      setResult({ type: 'error', message: getApiErrorMessage(error) })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.06] p-7 shadow-2xl shadow-black/30 backdrop-blur sm:p-10">
      <h2 className="text-2xl font-semibold">Payment details</h2>
      <p className="mt-2 text-sm leading-6 text-slate-400">
        Amounts are temporarily limited to 1 or 2,000 KHR for this exam. This is an exam
        restriction, not a PayWay limitation.
      </p>

      <form className="mt-8 space-y-6" onSubmit={handleSubmit} noValidate>
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-slate-200">
            Full name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            maxLength={NAME_MAX_LENGTH + 1}
            value={form.name}
            onChange={updateField}
            disabled={isSubmitting}
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? 'name-error' : undefined}
            className={inputClassName}
            placeholder="Sokha Example"
          />
          <FieldError id="name-error" message={fieldErrors.name} />
        </div>

        <div>
          <label htmlFor="accountNumber" className="block text-sm font-medium text-slate-200">
            Account number
          </label>
          <input
            id="accountNumber"
            name="accountNumber"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={ACCOUNT_NUMBER_MAX_LENGTH + 1}
            value={form.accountNumber}
            onChange={updateField}
            disabled={isSubmitting}
            aria-invalid={Boolean(fieldErrors.accountNumber)}
            aria-describedby={fieldErrors.accountNumber ? 'account-error' : 'account-help'}
            className={inputClassName}
            placeholder="0012345678"
          />
          <p id="account-help" className="mt-2 text-xs text-slate-500">
            Kept as text so leading zeros are preserved. No bank-specific format is assumed.
          </p>
          <FieldError id="account-error" message={fieldErrors.accountNumber} />
        </div>

        <div>
          <label htmlFor="amount" className="block text-sm font-medium text-slate-200">
            Amount (KHR)
          </label>
          <input
            id="amount"
            name="amount"
            type="text"
            inputMode="numeric"
            value={form.amount}
            onChange={updateField}
            disabled={isSubmitting}
            aria-invalid={Boolean(fieldErrors.amount)}
            aria-describedby={fieldErrors.amount ? 'amount-error' : 'amount-help'}
            className={inputClassName}
            placeholder="1 or 2000"
          />
          <p id="amount-help" className="mt-2 text-xs text-slate-500">
            Enter a whole KHR amount: 1 or 2000.
          </p>
          <FieldError id="amount-error" message={fieldErrors.amount} />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-emerald-400 px-5 py-3 font-semibold text-slate-950 transition hover:bg-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:cursor-wait disabled:opacity-60"
        >
          {isSubmitting ? 'Validating…' : 'Validate details'}
        </button>

        <SubmissionResult result={result} />
      </form>
    </section>
  )
}
