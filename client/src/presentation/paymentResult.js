// describe one safe result state
export function getPaymentResultPresentation(state, cancelled = false) {
  const status = state.payment?.status

  if (status === 'PAID') {
    return {
      title: 'Payment confirmed',
      message: 'The payment was verified by the backend.',
      tone: 'success',
    }
  }
  if (status === 'FAILED') {
    return {
      title: 'Payment failed',
      message: 'The saved transaction is marked as failed.',
      tone: 'error',
    }
  }
  if (status === 'CANCELLED') {
    return {
      title: 'Payment cancelled',
      message: 'The saved transaction is marked as cancelled.',
      tone: 'error',
    }
  }
  if (state.kind === 'missing_access') {
    return {
      title: 'Payment status unavailable',
      message: 'This browser session does not have access to this payment status.',
      tone: 'warning',
    }
  }
  if (state.kind === 'unavailable') {
    return {
      title: 'Payment status unavailable',
      message: 'The transaction or its browser access token could not be verified.',
      tone: 'warning',
    }
  }

  return {
    title: cancelled ? 'Checkout closed' : 'Checking payment status',
    message: 'Payment confirmation is still pending',
    tone: 'pending',
  }
}
