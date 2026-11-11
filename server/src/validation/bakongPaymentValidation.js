export const BAKONG_DESCRIPTION_MAX_LENGTH = 100
export const BAKONG_MIN_USD_AMOUNT = 0.01
export const BAKONG_MAX_USD_AMOUNT = 100000
export const BAKONG_MIN_KHR_AMOUNT = 100
export const BAKONG_MAX_KHR_AMOUNT = 100000000

const EXPECTED_FIELDS = ['amount', 'description']
const EXPECTED_FIELD_SET = new Set(EXPECTED_FIELDS)

// Record missing and unexpected request fields.
function validateFieldSet(body, errors) {
  for (const field of Object.keys(body)) {
    if (!EXPECTED_FIELD_SET.has(field)) errors[field] = 'Unexpected field.'
  }

  if (!Object.hasOwn(body, 'amount')) {
    errors.amount = 'This field is required.'
  }
}

// Validate one USD amount with at most two decimal places.
function validateUsdAmount(value, errors) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.amount = 'Amount must be a JSON number.'
    return
  }

  if (value < BAKONG_MIN_USD_AMOUNT || value > BAKONG_MAX_USD_AMOUNT) {
    errors.amount = `Amount must be between ${BAKONG_MIN_USD_AMOUNT} and ${BAKONG_MAX_USD_AMOUNT} USD.`
    return
  }

  if (Math.round(value * 100) !== value * 100) {
    errors.amount = 'Amount must have at most two decimal places.'
  }
}

// Validate one whole-KHR amount.
function validateKhrAmount(value, errors) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    errors.amount = 'Amount must be a whole KHR integer.'
    return
  }

  if (value < BAKONG_MIN_KHR_AMOUNT || value > BAKONG_MAX_KHR_AMOUNT) {
    errors.amount = `Amount must be between ${BAKONG_MIN_KHR_AMOUNT} and ${BAKONG_MAX_KHR_AMOUNT} KHR.`
  }
}

// Validate an optional payment description.
function validateDescription(value, errors) {
  if (value === undefined) return undefined

  if (typeof value !== 'string') {
    errors.description = 'Description must be a string.'
    return undefined
  }

  const normalized = value.trim()

  if (normalized.length > BAKONG_DESCRIPTION_MAX_LENGTH) {
    errors.description = `Description must be ${BAKONG_DESCRIPTION_MAX_LENGTH} characters or fewer.`
    return undefined
  }

  return normalized || undefined
}

// Validate one Bakong top-up request.
export function validateBakongPaymentDetails(body, { currency = 'USD' } = {}) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      isValid: false,
      errors: { body: 'Request body must be a JSON object.' },
    }
  }

  const errors = {}
  validateFieldSet(body, errors)

  if (Object.hasOwn(body, 'amount')) {
    if (currency === 'KHR') {
      validateKhrAmount(body.amount, errors)
    } else {
      validateUsdAmount(body.amount, errors)
    }
  }

  const description = validateDescription(body.description, errors)

  if (Object.keys(errors).length > 0) {
    return { isValid: false, errors }
  }

  return {
    isValid: true,
    data: {
      amount: body.amount,
      currency,
      description,
    },
  }
}
