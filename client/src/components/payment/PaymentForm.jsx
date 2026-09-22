import { useState } from 'react'
import {
  ACCOUNT_NUMBER_MAX_LENGTH,
  INITIAL_PAYMENT_FORM,
  NAME_MAX_LENGTH,
} from '../../config/payment.js'
import {
  getApiErrorMessage,
  prepareSandboxCheckout,
  submitHostedCheckout,
} from '../../services/api.js'
import { validatePaymentForm } from '../../validation/paymentForm.js'
import { FieldError } from '../form/FieldError.jsx'
import { SubmissionResult } from '../form/SubmissionResult.jsx'
import { saveCheckoutStatusAccess } from '../../services/statusAccess.js'

const inputClassName =
  'mt-2 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-base text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500'

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
      const response = await prepareSandboxCheckout(validation.data)

      if (!response.ok) {
        if (response.status === 400 && response.errors && typeof response.errors === 'object') {
          setFieldErrors(response.errors)
          setResult({ type: 'error', message: 'Please correct the highlighted details.' })
        } else {
          setResult({
            type: 'error',
            message: response.message || 'Checkout could not be prepared.',
          })
        }
        return
      }

      saveCheckoutStatusAccess(response.checkout)
      setResult({ type: 'success', message: 'Opening secure checkout…' })
      submitHostedCheckout(response.checkout)
    } catch (error) {
      setResult({ type: 'error', message: getApiErrorMessage(error) })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-6 py-5 sm:px-8">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-slate-950">Payment details</h2>
          <span className="text-xs font-medium uppercase tracking-wide text-amber-700">
            Sandbox
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500">All fields are required.</p>
      </div>

      <form className="space-y-5 px-6 py-6 sm:px-8 sm:py-7" onSubmit={handleSubmit} noValidate>
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-slate-700">
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
            placeholder="Sokha Dara"
          />
          <FieldError id="name-error" message={fieldErrors.name} />
        </div>

        <div>
          <label htmlFor="accountNumber" className="block text-sm font-medium text-slate-700">
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
          <p id="account-help" className="mt-1.5 text-xs text-slate-500">
            Leading zeros are preserved.
          </p>
          <FieldError id="account-error" message={fieldErrors.accountNumber} />
        </div>

        <div>
          <label htmlFor="amount" className="block text-sm font-medium text-slate-700">
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
          <p id="amount-help" className="mt-1.5 text-xs text-slate-500">
            Available amounts: 1 KHR or 2,000 KHR.
          </p>
          <FieldError id="amount-error" message={fieldErrors.amount} />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-lg bg-[#00b67a] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#009f6b] focus:outline-none focus:ring-2 focus:ring-[#00b67a] focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
        >
          {isSubmitting ? 'Preparing checkout…' : 'Continue to payment'}
        </button>

        <SubmissionResult result={result} />
      </form>
    </section>
  )
}
