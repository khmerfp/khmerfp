import {
  ACCOUNT_NUMBER_MAX_LENGTH,
  NAME_MAX_LENGTH,
} from '../models/transaction.js'

export const EXAM_AMOUNTS_KHR = [1, 2000]

// Define the expected fields for payment validation
const EXPECTED_FIELDS = ['name', 'accountNumber', 'amount']
const EXPECTED_FIELD_SET = new Set(EXPECTED_FIELDS)

export function validatePaymentDetails(body) {
  const errors = {}

  // if the body is not an object or is null, return an error
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      isValid: false,
      errors: { body: 'Request body must be a JSON object.' },
    }
  }

  // check for unexpected fields and missing required fields
  for (const field of Object.keys(body)) {
    if (!EXPECTED_FIELD_SET.has(field)) {
      errors[field] = 'Unexpected field.'
    }
  }

  // check for missing required fields
  for (const field of EXPECTED_FIELDS) {
    if (!Object.hasOwn(body, field)) {
      errors[field] = 'This field is required.'
    }
  }

  let name

  // validate the name field if it exists
  if (Object.hasOwn(body, 'name')) {
    if (typeof body.name !== 'string') {
      errors.name = 'Name must be a string.'
    } else {
      name = body.name.trim()
      if (name.length === 0) {
        errors.name = 'Name is required.'
      } else if (name.length > NAME_MAX_LENGTH) {
        errors.name = `Name must be ${NAME_MAX_LENGTH} characters or fewer.`
      }
    }
  }

  let accountNumber

  // validate the accountNumber field if it exists
  if (Object.hasOwn(body, 'accountNumber')) {
    if (typeof body.accountNumber !== 'string') {
      errors.accountNumber = 'Account number must be a string.'
    } else {
      accountNumber = body.accountNumber.trim()
      if (accountNumber.length === 0) {
        errors.accountNumber = 'Account number is required.'
      } else if (accountNumber.length > ACCOUNT_NUMBER_MAX_LENGTH) {
        errors.accountNumber = `Account number must be ${ACCOUNT_NUMBER_MAX_LENGTH} characters or fewer.`
      }
    }
  }

  // validate the amount field if it exists
  if (Object.hasOwn(body, 'amount')) {
    if (typeof body.amount !== 'number') {
      errors.amount = 'Amount must be a JSON number.'
    } else if (!Number.isSafeInteger(body.amount) || body.amount <= 0) {
      errors.amount = 'Amount must be a positive safe integer in whole KHR.'
    } else if (!EXAM_AMOUNTS_KHR.includes(body.amount)) {
      errors.amount = 'amount must be either 1 or 2000 KHR.'
    }
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
