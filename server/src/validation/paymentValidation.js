import {
  ACCOUNT_NUMBER_MAX_LENGTH,
  NAME_MAX_LENGTH,
} from '../models/transaction.js'

export const EXAM_AMOUNTS_KHR = [1, 2000]

// Define the expected fields for payment validation
const EXPECTED_FIELDS = ['name', 'accountNumber', 'amount']
const EXPECTED_FIELD_SET = new Set(EXPECTED_FIELDS)

// record missing and unexpected request fields
function validateFieldSet(body, errors) {
  for (const field of Object.keys(body)) {
    if (!EXPECTED_FIELD_SET.has(field)) errors[field] = 'Unexpected field.'
  }

  for (const field of EXPECTED_FIELDS) {
    if (!Object.hasOwn(body, field)) errors[field] = 'This field is required.'
  }
}

// validate and trim one text field
function validateTextField(value, errors, {
  field,
  label,
  maxLength,
}) {
  if (typeof value !== 'string') {
    errors[field] = `${label} must be a string.`
    return undefined
  }

  const normalized = value.trim()
  if (normalized.length === 0) {
    errors[field] = `${label} is required.`
  } else if (normalized.length > maxLength) {
    errors[field] = `${label} must be ${maxLength} characters or fewer.`
  }
  return normalized
}

// validate one whole khr amount
function validateAmount(value, errors) {
  if (typeof value !== 'number') {
    errors.amount = 'Amount must be a JSON number.'
  } else if (!Number.isSafeInteger(value) || value <= 0) {
    errors.amount = 'Amount must be a positive safe integer in whole KHR.'
  } else if (!EXAM_AMOUNTS_KHR.includes(value)) {
    errors.amount = 'amount must be either 1 or 2000 KHR.'
  }
}

// validate one payment request
export function validatePaymentDetails(body) {
  const errors = {}

  // if the body is not an object or is null, return an error
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      isValid: false,
      errors: { body: 'Request body must be a JSON object.' },
    }
  }

  validateFieldSet(body, errors)

  let name
  if (Object.hasOwn(body, 'name')) {
    name = validateTextField(body.name, errors, {
      field: 'name', label: 'Name', maxLength: NAME_MAX_LENGTH,
    })
  }

  let accountNumber
  if (Object.hasOwn(body, 'accountNumber')) {
    accountNumber = validateTextField(body.accountNumber, errors, {
      field: 'accountNumber',
      label: 'Account number',
      maxLength: ACCOUNT_NUMBER_MAX_LENGTH,
    })
  }

  if (Object.hasOwn(body, 'amount')) {
    validateAmount(body.amount, errors)
  }

  // if there are any errors, return them; otherwise, return the validated data
  if (Object.keys(errors).length > 0) {
    return { isValid: false, errors }
  }

  // return the validated data
  return {
    isValid: true,
    data: {
      name,
      accountNumber,
      amount: body.amount,
      currency: 'KHR',
    },
  }
}
