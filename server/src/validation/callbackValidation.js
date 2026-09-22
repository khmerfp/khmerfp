const REQUIRED_FIELDS = [
  'tran_id',
  'apv',
  'status',
  'original_amount',
  'original_currency',
  'payment_amount',
  'payment_currency',
  'total_amount',
  'discount_amount',
  'transaction_date',
]

// validate one callback amount
function validateAmount(value, field, errors) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    errors[field] = `${field} must be a non-negative JSON number.`
  }
}

// record required callback fields
function validateRequiredFields(payload, errors) {
  for (const field of REQUIRED_FIELDS) {
    if (!Object.hasOwn(payload, field)) errors[field] = 'This field is required.'
  }
}

// validate callback identifiers and status
function validateIdentifiers(payload, errors) {
  if (Object.hasOwn(payload, 'tran_id')) {
    if (typeof payload.tran_id !== 'string') {
      errors.tran_id = 'tran_id must be a string.'
    } else if (payload.tran_id.trim().length === 0 || payload.tran_id.length > 20) {
      errors.tran_id = 'tran_id must contain 1 to 20 characters.'
    }
  }

  if (Object.hasOwn(payload, 'apv') && (
    typeof payload.apv !== 'string' || payload.apv.length !== 6
  )) {
    errors.apv = 'apv must be a 6-character string.'
  }

  if (Object.hasOwn(payload, 'status') && (
    typeof payload.status !== 'string' || payload.status.length === 0
  )) {
    errors.status = 'status must be a non-empty string.'
  }
}

// validate callback date and currencies
function validateMetadata(payload, errors) {
  if (Object.hasOwn(payload, 'transaction_date') && (
    typeof payload.transaction_date !== 'string'
    || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(payload.transaction_date)
  )) {
    errors.transaction_date = 'transaction_date must use YYYY-MM-DD HH:MM:SS.'
  }

  for (const field of ['original_currency', 'payment_currency']) {
    if (Object.hasOwn(payload, field) && (
      typeof payload[field] !== 'string'
      || !['KHR', 'USD'].includes(payload[field])
    )) {
      errors[field] = `${field} must be either KHR or USD.`
    }
  }
}

// validate authenticated callback fields
export function validateCallbackPayload(payload) {
  const errors = {}

  validateRequiredFields(payload, errors)
  validateIdentifiers(payload, errors)

  for (const field of [
    'original_amount',
    'payment_amount',
    'total_amount',
    'discount_amount',
  ]) {
    if (Object.hasOwn(payload, field)) validateAmount(payload[field], field, errors)
  }

  validateMetadata(payload, errors)

  return Object.keys(errors).length > 0
    ? { isValid: false, errors }
    : {
        isValid: true,
        data: {
          tranId: payload.tran_id,
          approvalCode: payload.apv,
          status: payload.status,
          originalAmount: payload.original_amount,
          originalCurrency: payload.original_currency,
          paymentAmount: payload.payment_amount,
          paymentCurrency: payload.payment_currency,
          totalAmount: payload.total_amount,
          discountAmount: payload.discount_amount,
          transactionDate: payload.transaction_date,
        },
      }
}
