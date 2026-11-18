// SDK onboarding is simulated; API, ECDSA verification and disposable PostgreSQL are real.
import { test, expect } from '@playwright/test'
const token = process.env.WALLET_BROWSER_TOKEN
const headers = { Origin: 'http://127.0.0.1:5187', 'X-Wallet-Test-Token': token }
test('embedded onboarding, ownership persistence, recovery, unlink and relink', async ({ page, context }) => {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  // simulate only public project readiness; all other external requests remain blocked.
  await context.route('https://api.cdp.coinbase.com/platform/v2/embedded-wallet-api/projects/11111111-1111-4111-8111-111111111111/config', route => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:5187' }, body: '{}',
  }))
  await page.addInitScript(token => { window.__WALLET_E2E_TOKEN = token }, token)
  expect((await context.request.post('/__test/reset-clock', { headers })).ok()).toBeTruthy()
  const registration = await context.request.post('/api/auth/register', { headers, data: {
    email: `embedded-${Date.now()}@example.test`, password: 'DisposableEmbeddedOnly!37', displayName: 'Embedded tester', language: 'en',
  } })
  expect(registration.status()).toBe(201)
  await page.goto('/account/wallets?embedded-wallet')
  await page.getByText('Simulate CDP email verification').click()
  await expect(page.getByText('CDP wallet signed in')).toBeVisible()
  await page.getByText('Prepare ownership verification').click()
  await expect(page.getByText('Review ownership message')).toBeVisible()
  await page.getByRole('checkbox').check()
  await page.getByText('Sign and verify ownership').click()
  await expect(page.getByText('EOA / VERIFIED / ACTIVE')).toBeVisible()
  await page.reload()
  await expect(page.getByText('CDP wallet signed in')).toBeVisible()
  await expect(page.getByText('EOA / VERIFIED / ACTIVE')).toBeVisible()
  expect((await context.request.post('/__test/step-up', { headers })).ok()).toBeTruthy()
  await page.getByText('Prepare unlink proof').click()
  await page.getByRole('checkbox').check(); await page.getByText('Sign and verify ownership').click()
  await expect(page.getByText('EOA / VERIFIED / REVOKED')).toBeVisible()
  await page.getByText('Prepare ownership verification').click()
  await page.getByRole('checkbox').check(); await page.getByText('Sign and verify ownership').click()
  await expect(page.getByText('EOA / VERIFIED / ACTIVE')).toBeVisible()
  await page.getByText('Sign out of CDP / Switch wallet').click()
  await expect(page.getByText('Simulate CDP email verification')).toBeVisible()
})
