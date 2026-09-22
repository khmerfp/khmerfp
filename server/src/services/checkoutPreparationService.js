import { getPayWayConfig } from '../config/payway.js'
import { signPurchase } from '../payway/purchaseSigning.js'
import {
  preparePendingTransaction,
} from './pendingTransactionService.js'

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

// prepare a signed sandbox checkout form
export async function prepareSandboxCheckout(
  paymentDetails,
  {
    config = getPayWayConfig(),
    now = () => new Date(),
    prepareTransaction = preparePendingTransaction,
    signer = signPurchase,
  } = {},
) {
  if (!config.checkoutEnabled || config.environment !== 'sandbox') {
    throw new CheckoutUnavailableError()
  }

  const pendingTransaction = await prepareTransaction(paymentDetails)
  const amount = formatKhrAmount(pendingTransaction.amount)
  const fields = {
    req_time: formatPayWayRequestTime(now()),
    merchant_id: config.credentials.merchantId,
    tran_id: pendingTransaction.tranId,
    amount,
    cancel_url: config.navigation.cancelUrl,
    continue_success_url: config.navigation.successUrl,
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
  }
}
