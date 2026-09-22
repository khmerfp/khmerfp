import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getHostedCheckoutEntries } from '../../client/src/services/api.js'
import { validatePaymentForm } from '../../client/src/validation/paymentForm.js'

for (const amount of ['1', '2000']) {
  // verify one exact browser form amount
  test(`frontend submits one unchanged ${amount} KHR field`, () => {
    const validation = validatePaymentForm({
      name: 'Example Sender',
      accountNumber: '00001234',
      amount,
    })
    assert.equal(validation.isValid, true)
    assert.equal(validation.data.amount, Number(amount))

    const entries = getHostedCheckoutEntries({
      fields: {
        req_time: '20260921123456',
        merchant_id: 'fictional-merchant',
        tran_id: '12345678901234567890',
        amount,
        cancel_url: 'https://example.test/payment/cancel',
        continue_success_url: 'https://example.test/payment/result',
        currency: 'KHR',
        view_type: 'hosted_view',
        payment_gate: '0',
        hash: 'fictional-signature',
      },
    })

    assert.deepEqual(entries.filter(([name]) => name === 'currency'), [
      ['currency', 'KHR'],
    ])
    assert.deepEqual(entries.filter(([name]) => name === 'amount'), [
      ['amount', amount],
    ])
    assert.equal(entries.some(([name]) => name === 'payment_option'), false)
    assert.deepEqual(entries.filter(([name]) => name === 'view_type'), [
      ['view_type', 'hosted_view'],
    ])
    assert.deepEqual(entries.filter(([name]) => name === 'payment_gate'), [
      ['payment_gate', '0'],
    ])
  })
}
