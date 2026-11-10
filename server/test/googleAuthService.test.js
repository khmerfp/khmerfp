import assert from 'node:assert/strict'
import { test } from 'node:test'

import { classifyGoogleVerificationError } from '../src/services/googleAuthService.js'

test('google verification failures are classified for the route', () => {
  assert.equal(
    classifyGoogleVerificationError({ code: 'ETIMEDOUT' }),
    'verification_unavailable',
  )
  assert.equal(
    classifyGoogleVerificationError(
      new Error('Wrong recipient, payload audience != requiredAudience'),
    ),
    'audience_mismatch',
  )
  assert.equal(
    classifyGoogleVerificationError(new Error('Invalid token signature')),
    'invalid_token',
  )
  assert.equal(
    classifyGoogleVerificationError(new Error('Token used too late')),
    'invalid_token',
  )
})
