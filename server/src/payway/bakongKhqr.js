import bakongKhqr from 'bakong-khqr'

const { BakongKHQR, khqrData, IndividualInfo } = bakongKhqr

export const BAKONG_MERCHANT_CATEGORY_CODE = '5999'

export class BakongKhqrError extends Error {
  constructor(message = 'KHQR generation failed.', options = {}) {
    super(message, options)
    this.name = 'BakongKhqrError'
  }
}

// Map the configured currency to the SDK currency constant.
function toSdkCurrency(currency) {
  return currency === 'KHR' ? khqrData.currency.khr : khqrData.currency.usd
}

// Read a human-readable message from the SDK error shape.
function readSdkErrorMessage(error) {
  if (typeof error?.status?.message === 'string' && error.status.message) {
    return error.status.message
  }

  if (typeof error?.message === 'string' && error.message) {
    return error.message
  }

  return 'KHQR generation failed.'
}

// Generate one dynamic KHQR string and its MD5 hash.
export function generateBakongKhqr({
  accountId,
  merchantName,
  merchantCity,
  acquiringBank,
  amount,
  currency,
  billNumber,
  expiresAt,
  storeLabel,
}) {
  if (typeof accountId !== 'string' || accountId.trim() === '') {
    throw new BakongKhqrError('Bakong account ID is required.')
  }

  if (typeof merchantName !== 'string' || merchantName.trim() === '') {
    throw new BakongKhqrError('Merchant name is required.')
  }

  if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) {
    throw new BakongKhqrError('KHQR expiration time is required.')
  }

  const info = new IndividualInfo(
    accountId.trim(),
    merchantName.trim(),
    merchantCity.trim(),
    {
      acquiringBank,
      currency: toSdkCurrency(currency),
      amount,
      billNumber,
      storeLabel,
      purposeOfTransaction: 'Top up',
      expirationTimestamp: expiresAt.getTime(),
      merchantCategoryCode: BAKONG_MERCHANT_CATEGORY_CODE,
    },
  )

  let response

  try {
    response = new BakongKHQR().generateIndividual(info)
  } catch (error) {
    throw new BakongKhqrError(readSdkErrorMessage(error), { cause: error })
  }

  if (response?.status?.code !== 0) {
    throw new BakongKhqrError(readSdkErrorMessage(response))
  }

  const qrString = response?.data?.qr
  const md5 = response?.data?.md5

  if (typeof qrString !== 'string' || qrString === '') {
    throw new BakongKhqrError('KHQR generation returned no QR string.')
  }

  if (typeof md5 !== 'string' || !/^[a-f0-9]{32}$/.test(md5)) {
    throw new BakongKhqrError('KHQR generation returned an invalid MD5 hash.')
  }

  return { qrString, md5 }
}
