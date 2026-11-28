import { randomBytes } from 'node:crypto'

// Keep SDK calls and provider response field names in this file.
const MOCK_USER = {
  nationality: 'KH',
  idType: 'NATIONAL_ID',
  dateOfBirth: '2000-01-01',
  sub: 'mock-camdigikey-user',
}

export async function getLoginToken() {
  if (process.env.CAMDIGIKEY_MOCK_MODE === 'true') {
    return `mock-${randomBytes(16).toString('hex')}`
  }

  // TODO: replace with the official CamDigiKey SDK login-token method.
  throw new Error('CamDigiKey SDK is not configured.')
}

export async function exchangeAuthToken(authToken) {
  if (process.env.CAMDIGIKEY_MOCK_MODE === 'true') return authToken

  // TODO: replace with the official CamDigiKey SDK token-exchange method.
  throw new Error('CamDigiKey SDK is not configured.')
}

export async function getUserInfo(accessToken) {
  if (process.env.CAMDIGIKEY_MOCK_MODE === 'true') {
    const mockJson = process.env.CAMDIGIKEY_MOCK_USER_INFO
    return mockJson ? JSON.parse(mockJson) : MOCK_USER
  }

  // TODO: replace with the official CamDigiKey SDK user-info method.
  // TODO: replace 'KH' and 'NATIONAL_ID' with CamDX's official value names.
  // TODO: map official nationality, ID type, date-of-birth, and subject fields here.
  void accessToken
  throw new Error('CamDigiKey SDK is not configured.')
}

// TODO: set these environment values from the official CamDigiKey onboarding docs:
// CAMDIGIKEY_CLIENT_ID, CAMDIGIKEY_CLIENT_SECRET, CAMDIGIKEY_SIGNING_KEY_PATH,
// CAMDIGIKEY_KEYSTORE_PATH, CAMDIGIKEY_KEYSTORE_PASSWORD,
// CAMDIGIKEY_REDIRECT_URI, CAMDIGIKEY_BASE_URL.
