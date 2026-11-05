import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

import TopUpModal from './TopUpModal.jsx'
import {
  createBakongPayment,
  getBakongPaymentStatus,
} from '../services/paymentApi.js'

const mocks = vi.hoisted(() => ({
  refreshWallet: vi.fn(),
  showToast: vi.fn(),
  onClose: vi.fn(),
}))

vi.mock('../state/AppContext.jsx', () => ({
  useApp: () => ({
    lang: 'en',
    refreshWallet: mocks.refreshWallet,
    showToast: mocks.showToast,
  }),
}))

vi.mock('../services/paymentApi.js', () => ({
  createBakongPayment: vi.fn(),
  getBakongPaymentStatus: vi.fn(),
}))

vi.mock('qrcode.react', () => ({
  QRCodeSVG: () => null,
}))

const CREATED_PAYMENT = {
  payment: {
    tranId: 'FP123',
    amount: 25,
    currency: 'USD',
    status: 'PENDING',
    qrString: '000201010212',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  },
  statusAccess: { tranId: 'FP123', token: 'T'.repeat(43) },
}

async function startPayment() {
  render(<TopUpModal onClose={mocks.onClose} />)

  fireEvent.click(
    screen.getByRole('button', { name: /Generate Bakong KHQR/i }),
  )

  await act(async () => {
    await Promise.resolve()
  })

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1200)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.refreshWallet.mockResolvedValue({ KHR: 0, USD: 25 })
  createBakongPayment.mockResolvedValue(CREATED_PAYMENT)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TopUpModal Bakong payments', () => {
  it('refreshes the wallet and closes only after the server reports PAID', async () => {
    getBakongPaymentStatus.mockResolvedValue({ status: 'PAID', amount: 25 })

    await startPayment()

    expect(createBakongPayment).toHaveBeenCalledWith({
      amount: 25,
      idempotencyKey: expect.any(String),
    })
    expect(getBakongPaymentStatus).toHaveBeenCalledWith(
      'FP123',
      'T'.repeat(43),
    )
    expect(mocks.refreshWallet).toHaveBeenCalledTimes(1)
    expect(mocks.showToast).toHaveBeenCalledWith('success', expect.any(String))
    expect(screen.getByText('Payment confirmed!')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })

    expect(mocks.onClose).toHaveBeenCalledTimes(1)
  })

  it('does not credit the balance when the payment expires', async () => {
    getBakongPaymentStatus.mockResolvedValue({ status: 'EXPIRED' })

    await startPayment()

    expect(mocks.refreshWallet).not.toHaveBeenCalled()
    expect(mocks.showToast).not.toHaveBeenCalled()
    expect(
      screen.getByText(/This QR code has expired/i),
    ).toBeInTheDocument()
  })

  it('does not credit the balance when the payment fails', async () => {
    getBakongPaymentStatus.mockResolvedValue({ status: 'FAILED' })

    await startPayment()

    expect(mocks.refreshWallet).not.toHaveBeenCalled()
    expect(
      screen.getByText(/This QR code has expired/i),
    ).toBeInTheDocument()
  })

  it('keeps polling after a transient status error', async () => {
    getBakongPaymentStatus
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ status: 'PAID', amount: 25 })

    await startPayment()

    expect(mocks.refreshWallet).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    expect(mocks.refreshWallet).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Payment confirmed!')).toBeInTheDocument()
  })

  it('uses a new idempotency key when the amount changes after a failure', async () => {
    createBakongPayment
      .mockRejectedValueOnce(new Error('network failure'))
      .mockResolvedValueOnce(CREATED_PAYMENT)

    render(<TopUpModal onClose={mocks.onClose} />)

    fireEvent.click(
      screen.getByRole('button', { name: /Generate Bakong KHQR/i }),
    )

    await act(async () => {
      await Promise.resolve()
    })

    fireEvent.change(screen.getByRole('spinbutton'), {
      target: { value: '50' },
    })

    fireEvent.click(
      screen.getByRole('button', { name: /Generate Bakong KHQR/i }),
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(createBakongPayment).toHaveBeenCalledTimes(2)
    expect(createBakongPayment.mock.calls[0][0].amount).toBe(25)
    expect(createBakongPayment.mock.calls[1][0].amount).toBe(50)
    expect(createBakongPayment.mock.calls[0][0].idempotencyKey).not.toBe(
      createBakongPayment.mock.calls[1][0].idempotencyKey,
    )
  })
})
