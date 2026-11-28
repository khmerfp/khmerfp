import { Link, useSearchParams } from 'react-router-dom'

const messages = {
  ok: 'Your Cambodian identity has been verified.',
  rejected: 'We could not verify your identity. Check that you used a Cambodian national ID card, then try again.',
  denied: 'Your account is temporarily denied.',
  error: 'Verification could not be completed. Please try again later.',
}

export default function VerifyResult() {
  const [searchParams] = useSearchParams()
  const status = searchParams.get('status')
  const retryAt = searchParams.get('retryAt')
  const retryDate = retryAt ? new Date(retryAt) : null
  const retryMessage = status === 'denied'
    && retryDate
    && !Number.isNaN(retryDate.getTime())
    ? `You can try again after ${retryDate.toLocaleString()}.`
    : null

  return (
    <main className="mx-auto min-h-[60vh] max-w-xl px-6 py-16 text-center text-[#0A0E14] dark:text-white">
      <h1 className="mb-4 text-2xl font-semibold">CamDigiKey verification</h1>
      <p className="mb-8 text-[#5B6472] dark:text-white/75">
        {retryMessage || messages[status] || 'The verification result is not recognized.'}
      </p>
      <Link className="text-[#33C7A6] underline" to="/">Return to KhmerFP</Link>
    </main>
  )
}
