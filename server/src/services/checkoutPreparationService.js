import { getPayWayConfig } from '../config/payway.js'
import { signPurchase } from '../payway/purchaseSigning.js'
import {
  preparePendingTransaction,
} from './pendingTransactionService.js'
import {
  generateStatusAccessToken,
  hashStatusAccessToken,
} from '../payway/statusAccessToken.js'

export class CheckoutUnavailableError extends Error {
  // create a safe checkout availability error
  constructor(message = 'Sandbox checkout is disabled.') {
    super(message)
    this.name = 'CheckoutUnavailableError'
  }
}

// format utc time for PayWay
export function formatPayWayRequestTime(date) {
  return date.toISOString().replace(/[-:T]/g, '').slice(0, 14)
}

// format whole khr without decimals
export function formatKhrAmount(amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new TypeError('KHR amount must be a positive safe integer.')
  }

  return String(amount)
}

// add only the transaction id to a browser return url
export function buildTransactionReturnUrl(baseUrl, transactionId) {
  const returnUrl = new URL(baseUrl)
  returnUrl.searchParams.set('tran_id', transactionId)
  return returnUrl.toString()
}

// prepare a signed sandbox checkout form
export async function prepareSandboxCheckout(
  paymentDetails,
  {
    config = getPayWayConfig(),
    now = () => new Date(),
    prepareTransaction = preparePendingTransaction,
    signer = signPurchase,
    createStatusToken = generateStatusAccessToken,
    hashStatusToken = hashStatusAccessToken,
  } = {},
) {
  if (!config.checkoutEnabled || config.environment !== 'sandbox') {
    throw new CheckoutUnavailableError()
  }

  const statusAccessToken = createStatusToken()
  const statusAccessTokenHash = hashStatusToken(statusAccessToken)
  const pendingTransaction = await prepareTransaction(paymentDetails, {
    statusAccessTokenHash,
  })
  const amount = formatKhrAmount(pendingTransaction.amount)
  const fields = {
    req_time: formatPayWayRequestTime(now()),
    merchant_id: config.credentials.merchantId,
    tran_id: pendingTransaction.tranId,
    amount,
    cancel_url: buildTransactionReturnUrl(
      config.navigation.cancelUrl,
      pendingTransaction.tranId,
    ),
    continue_success_url: buildTransactionReturnUrl(
      config.navigation.successUrl,
      pendingTransaction.tranId,
    ),
    currency: 'KHR',
    view_type: 'hosted_view',
    payment_gate: '0',
  }

  const hash = signer(fields, config.credentials.apiKey)

  return {
    environment: 'sandbox',
    action: config.endpoints.purchase,
    method: 'POST',
    fields: { ...fields, hash },
    transaction: {
      tranId: pendingTransaction.tranId,
      amount: pendingTransaction.amount,
      currency: pendingTransaction.currency,
      status: pendingTransaction.status,
    },
    statusAccess: {
      tranId: pendingTransaction.tranId,
      token: statusAccessToken,
    },
  }
}
