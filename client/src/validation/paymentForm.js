import {
  ACCOUNT_NUMBER_MAX_LENGTH,
  EXAM_AMOUNTS_KHR,
  NAME_MAX_LENGTH,
} from '../config/payment.js'

// validate the browser form fields
export function validatePaymentForm(form) {
  const errors = {}
  const name = form.name.trim()
  const accountNumber = form.accountNumber.trim()
  const allowedAmountStrings = EXAM_AMOUNTS_KHR.map(String)

  if (!name) errors.name = 'Enter your full name.'
  else if (name.length > NAME_MAX_LENGTH) {
    errors.name = `Name must be ${NAME_MAX_LENGTH} characters or fewer.`
  }

  if (!accountNumber) errors.accountNumber = 'Enter an account number.'
  else if (accountNumber.length > ACCOUNT_NUMBER_MAX_LENGTH) {
    errors.accountNumber = `Account number must be ${ACCOUNT_NUMBER_MAX_LENGTH} characters or fewer.`
  }

  if (!allowedAmountStrings.includes(form.amount)) {
    errors.amount = 'Enter either 1 KHR or 2,000 KHR.'
  }

  if (Object.keys(errors).length > 0) {
    return { isValid: false, errors }
  }

  return {
    isValid: true,
    data: {
      name,
      accountNumber,
      // Conversion happens only after an exact allow-list match.
      amount: Number(form.amount),
    },
  }
}
